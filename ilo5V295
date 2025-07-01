// === iLO5 Monitoring für ioBroker (Redfish) ===
// Version: 01.07.2025 | Lucifor (Redfish, iLO 5 v2.95)
// Komplettskript für ioBroker mit Redfish, Telegram, Alexa
// ACHTUNG - STATUS TESTING

/***** KONFIGURATION *****/
const iloIP   = 'DEINEILO5IP';           // IP/Hostname der iLO5
const iloUser = 'ILO-BENUTZER';          // iLO-Benutzer
const iloPass = 'ILO-PASSWORT';          // iLO-Passwort
const telegramInstance = 'telegram.0';   // Telegram-Adapter
const telegramUser     = 'TELEGRAMUSER'; // Telegram-Benutzer
const alexaDP          = 'alexa2.0.Echo-Devices.XXXXXXXXXX.Commands.speak'; // Alexa-Gerät
const tempLimitCPU     = 70;             // Alarmgrenze CPU
const dpPrefix         = 'javascript.0.ilo5-testing.'; // Datenpunkt-Präfix
const pollIntervalMin  = 2;              // Abfrage-Intervall in Minuten

const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

function sanitizeId(raw) {
    return String(raw)
        .trim()
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .replace(/_+$/g, '')
        .replace(/^_+/, '')
        .replace(/\.+$/, '');
}

/***** Session-Handling (Redfish/X-Auth-Token) *****/
async function createSession() {
    try {
        const res = await axios.post(
            `https://${iloIP}/redfish/v1/SessionService/Sessions`,
            { UserName: iloUser, Password: iloPass },
            { httpsAgent: agent, headers: { 'Content-Type': 'application/json' } }
        );
        return { token: res.headers['x-auth-token'], cookie: res.headers['set-cookie'] };
    } catch (e) {
        log(`iLO5 Login fehlgeschlagen: ${e.message}`, 'error');
        throw new Error('Login fehlgeschlagen');
    }
}

async function destroySession(cookie) {
    // iLO5 empfiehlt Logout: Session-DELETE (optional)
    try {
        await axios.delete(`https://${iloIP}/redfish/v1/SessionService/Sessions`, {
            httpsAgent: agent,
            headers: { Cookie: cookie }
        });
    } catch (_) {}
}

function rfGet(url, token, cookie) {
    return axios.get(url, {
        httpsAgent: agent,
        headers: {
            'X-Auth-Token': token,
            'Cookie': cookie,
            'Accept': 'application/json'
        }
    });
}

/***** Temperaturen & Lüfter (Redfish) *****/
async function fetchThermal(token, cookie) {
    try {
        const res = await rfGet(`https://${iloIP}/redfish/v1/Chassis/1/Thermal`, token, cookie);
        const data = res.data;
        log('Thermal-Daten erfolgreich abgerufen.', 'info');
        if (Array.isArray(data.Temperatures)) {
            data.Temperatures.forEach(temp => {
                if (temp.ReadingCelsius > 0) {
                    const name = sanitizeId(temp.Name || temp.SensorNumber || temp.PhysicalContext);
                    const dp = dpPrefix + 'temperatures.' + name;
                    createState(dp, 0, {
                        name: temp.Name,
                        unit: '°C',
                        type: 'number',
                        role: 'value.temperature',
                        read: true,
                        write: false
                    }, () => setState(dp, temp.ReadingCelsius, true));
                    if (String(temp.PhysicalContext).includes('CPU') && temp.ReadingCelsius > tempLimitCPU) {
                        sendTo(telegramInstance, {
                            user: telegramUser,
                            text: `⚠️ Achtung! CPU-Temperatur "${temp.Name}" = ${temp.ReadingCelsius} °C (Grenze: ${tempLimitCPU} °C)`
                        });
                        setState(alexaDP, {
                            val: `Achtung! Die Temperatur der ${temp.Name} beträgt ${temp.ReadingCelsius} Grad.`,
                            ack: false
                        });
                    }
                }
            });
        }
        if (Array.isArray(data.Fans)) {
            data.Fans.forEach(fan => {
                const name = sanitizeId(fan.Name || fan.MemberId);
                const dp = dpPrefix + 'fans.' + name;
                createState(dp, 0, {
                    name: fan.Name,
                    unit: '%',
                    type: 'number',
                    role: 'value.speed',
                    read: true,
                    write: false
                }, () => setState(dp, fan.Reading, true));
            });
        }
    } catch (e) {
        log(`Fehler beim Abrufen der Thermal-Daten: ${e.message}`, 'error');
    }
}

/***** Systeminfo (Modell, SN, BIOS) *****/
async function fetchSystemInfo(token, cookie) {
    try {
        const res = await rfGet(`https://${iloIP}/redfish/v1/Systems/1`, token, cookie);
        const sys = res.data;
        const map = {
            Model: sys.Model,
            SerialNumber: sys.SerialNumber,
            BIOSVersion: sys.BiosVersion,
            HostName: sys.HostName
        };
        for (const [key, val] of Object.entries(map)) {
            const dp = dpPrefix + 'system.' + sanitizeId(key);
            createState(dp, '', { name: key, type: 'string', role: 'text', read: true, write: false }, () => setState(dp, val, true));
        }
        log('Systeminfo erfolgreich abgerufen.', 'info');
    } catch (e) {
        log(`Systeminfo-Fehler: ${e.message}`, 'error');
    }
}
/***** Power (Verbrauch, Netzteilstatus) *****/
async function fetchPower(token, cookie) {
    try {
        const res = await rfGet(`https://${iloIP}/redfish/v1/Chassis/1/Power`, token, cookie);
        const pwr = res.data;
        const watts = pwr.PowerControl?.[0]?.PowerConsumedWatts;
        if (typeof watts === 'number' && watts > 0) {
            const dp = dpPrefix + 'power.PowerConsumedWatts';
            createState(dp, 0, {
                name: 'Verbrauch', unit: 'W', type: 'number', role: 'value.power', read: true, write: false
            }, () => setState(dp, watts, true));
        }
        if (Array.isArray(pwr.PowerSupplies)) {
            pwr.PowerSupplies.forEach((psu, idx) => {
                const prefix = dpPrefix + `power.PSU_${idx + 1}`;
                const health = psu?.Status?.Health || 'n/a';
                const state  = psu?.Status?.State || 'n/a';
                const status = `${health} / ${state}`;
                const values = {
                    Name: psu.Name,
                    Status: status,
                    PowerCapacityWatts: psu.PowerCapacityWatts,
                    LastPowerOutputWatts: psu.LastPowerOutputWatts
                };
                for (const [key, val] of Object.entries(values)) {
                    const dp = prefix + '.' + sanitizeId(key);
                    createState(dp, '', {
                        name: key,
                        type: typeof val === 'number' ? 'number' : 'string',
                        role: 'text',
                        read: true,
                        write: false
                    }, () => setState(dp, val, true));
                }
                if (health !== 'OK' || state !== 'Enabled') {
                    const meldung = `⚠️ Netzteil PSU ${idx + 1} meldet Status: ${status}`;
                    sendTo(telegramInstance, { user: telegramUser, text: meldung });
                    setState(alexaDP, { val: `Achtung! Netzteil ${idx + 1} hat den Status ${status} erreicht.`, ack: false });
                }
            });
        }
        log('Power erfolgreich abgerufen.', 'info');
    } catch (e) {
        log(`Power-Fehler: ${e.message}`, 'error');
    }
}

/***** Firmware/Management-Controller *****/
async function fetchFirmware(token, cookie) {
    try {
        const res = await rfGet(`https://${iloIP}/redfish/v1/Managers/1`, token, cookie);
        const fw = res.data.FirmwareVersion;
        const map = { iLOFirmwareVersion: fw };
        for (const [key, val] of Object.entries(map)) {
            const dp = dpPrefix + 'firmware.' + sanitizeId(key);
            createState(dp, '', { name: key, type: 'string', role: 'text', read: true, write: false }, () => setState(dp, val, true));
        }
        log('Firmware-Version erfolgreich abgerufen.', 'info');
    } catch (e) {
        log(`Firmware-Fehler: ${e.message}`, 'error');
    }
}

/***** Netzwerkdaten *****/
async function fetchNetwork(token, cookie) {
    try {
        const res = await rfGet(`https://${iloIP}/redfish/v1/Managers/1/EthernetInterfaces/1`, token, cookie);
        const net = res.data;
        const map = {
            MACAddress: net.MACAddress,
            IPv4: net.IPv4Addresses?.[0]?.Address || net.IPv4?.[0]?.Address
        };
        for (const [key, val] of Object.entries(map)) {
            const dp = dpPrefix + 'network.' + sanitizeId(key);
            createState(dp, '', { name: key, type: 'string', role: 'text', read: true, write: false }, () => setState(dp, val, true));
        }
        log('Netzwerkdaten erfolgreich abgerufen.', 'info');
    } catch (e) {
        log(`Netzwerk-Fehler: ${e.message}`, 'error');
    }
}

/***** BIOS-Settings (Redfish) *****/
async function fetchBios(token, cookie) {
    try {
        const res = await rfGet(`https://${iloIP}/redfish/v1/Systems/1/Bios/Settings`, token, cookie);
        const bios = res.data;
        let dumpText = '🧬 BIOS-Felder:\n';
        for (const [key, val] of Object.entries(bios)) {
            const dp = dpPrefix + 'bios.' + sanitizeId(key);
            const valueType = typeof val === 'boolean' ? 'boolean' : (typeof val === 'number' ? 'number' : 'string');
            dumpText += `• ${key}: ${val}\n`;
            createState(dp, '', {
                name: key, type: valueType, role: 'text', read: true, write: false
            }, () => setState(dp, val, true));
        }
        const dumpDP = dpPrefix + 'bios.__dump';
        createState(dumpDP, '', {
            name: 'Alle BIOS-Werte (Text)', type: 'string', role: 'text', read: true, write: false
        }, () => setState(dumpDP, dumpText.trim(), true));
        log('BIOS-Settings erfolgreich abgerufen.', 'info');
    } catch (e) {
        if (e.response?.status === 404) {
            log('BIOS-Settings-API wird von dieser iLO-Version nicht unterstützt.', 'warn');
        } else {
            log(`BIOS-Fehler: ${e.message}`, 'error');
        }
    }
}
/***** Festplatten (Smart Storage/Drives) *****/
async function fetchDisks(token, cookie) {
    try {
        // Achtung: ArrayController ID kann je nach System anders sein (meist 0 oder 1)
        const ctrlRes = await rfGet(`https://${iloIP}/redfish/v1/Systems/1/SmartStorage/ArrayControllers/0`, token, cookie);
        const ctrl = ctrlRes.data;
        const drives = ctrl?.Links?.PhysicalDrives || ctrl?.links?.PhysicalDrives;
        if (!drives?.length) {
            log('Keine PhysicalDrives-Verlinkung gefunden.', 'warn');
            return;
        }
        for (const member of drives) {
            const url = member['@odata.id'] || member['href'];
            if (!url) continue;
            const detail = await rfGet(`https://${iloIP}${url}`, token, cookie);
            const d = detail.data;
            const prefix = dpPrefix + `disks.Drive_${sanitizeId(d.Location || d.Id || d.Model)}`;
            const values = {
                Location: d.Location,
                Model: d.Model,
                CapacityMiB: d.CapacityMiB,
                Status: `${d.Status?.Health || 'n/a'} / ${d.Status?.State || 'n/a'}`
            };
            for (const [key, val] of Object.entries(values)) {
                const dp = prefix + '.' + sanitizeId(key);
                createState(dp, '', {
                    name: key,
                    type: typeof val === 'number' ? 'number' : 'string',
                    role: 'text',
                    read: true,
                    write: false
                }, () => setState(dp, val, true));
            }
        }
        log('Festplatten erfolgreich abgerufen.', 'info');
    } catch (e) {
        log(`Festplatten-Fehler: ${e.message}`, 'error');
    }
}

/***** RAID & Logical Drives (SMART) *****/
async function fetchRaidAndSmart(token, cookie) {
    try {
        const ctrlRes = await rfGet(`https://${iloIP}/redfish/v1/Systems/1/SmartStorage/ArrayControllers/0`, token, cookie);
        const ctrl = ctrlRes.data;
        const raidDP = dpPrefix + 'raid.Configuration';
        createState(raidDP, '', {
            name: 'RAID Konfiguration', type: 'string', role: 'text', read: true, write: false
        }, () => {
            const confText = `Model: ${ctrl.Model}\nFirmware: ${ctrl.FirmwareVersion}\nStatus: ${ctrl.Status?.Health}`;
            setState(raidDP, confText, true);
        });
        const logicals = ctrl?.Links?.LogicalDrives || ctrl?.links?.LogicalDrives;
        if (!logicals?.length) {
            log('Keine LogicalDrives-Verlinkung gefunden.', 'warn');
            return;
        }
        for (const member of logicals) {
            const url = member['@odata.id'] || member['href'];
            if (!url) continue;
            const detail = await rfGet(`https://${iloIP}${url}`, token, cookie);
            const smartDP = dpPrefix + `smart.LogicalDrive_${sanitizeId(detail.data.Id || detail.data.Raid || url)}`;
            const map = {
                RaidLevel: detail.data.Raid,
                CapacityMiB: detail.data.CapacityMiB,
                Status: `${detail.data.Status?.Health || ''} / ${detail.data.Status?.State || ''}`
            };
            for (const [key, val] of Object.entries(map)) {
                const dp = smartDP + '.' + sanitizeId(key);
                createState(dp, '', {
                    name: key,
                    type: typeof val === 'number' ? 'number' : 'string',
                    role: 'text',
                    read: true,
                    write: false
                }, () => setState(dp, val, true));
            }
        }
        log('RAID/SMART erfolgreich abgerufen.', 'info');
    } catch (e) {
        log(`RAID/SMART Fehler: ${e.message}`, 'error');
    }
}

/***** Hauptausführung *****/
async function readILO() {
    let session = null;
    try {
        session = await createSession();
        const { token, cookie } = session;
        await fetchThermal(token, cookie);
        await fetchSystemInfo(token, cookie);
        await fetchPower(token, cookie);
        await fetchFirmware(token, cookie);
        await fetchNetwork(token, cookie);
        await fetchBios(token, cookie);
        await fetchDisks(token, cookie);
        await fetchRaidAndSmart(token, cookie);
    } catch (e) {
        log('iLO5-Redfish-Workflow-Fehler: ' + e.message, 'error');
    } finally {
        if (session && session.cookie) destroySession(session.cookie);
    }
}
// Start und Intervall
readILO();
schedule(`*/${pollIntervalMin} * * * *`, readILO); // Abfrageintervall in Minuten

/***** OPTIONAL: Testfunktion für Alexa-Ansage (abschaltbar) *****/
// Für Debug/Test kannst du folgende Zeile verwenden, damit Alexa minütlich ansagt, dass das Script läuft.
// const enableTestAlexa = false;
// if (enableTestAlexa) schedule('* * * * *', () => setState(alexaDP, { val: 'iLO5 Monitoring Script läuft!', ack: false }));

/***** HINWEISE *****
- Script in ioBroker JavaScript-Engine einfügen (npm-Modul "axios" muss im js-controller installiert sein!)
  Installation: Im ioBroker-Container/Host: npm install axios
- Zugangsdaten & Präfix wie gewünscht anpassen
- Telegram- und Alexa-Ziel festlegen
- Eventuell ArrayController-ID (bei sehr altem RAID-Setup) von "0" auf "1" ändern
- Sämtliche createState/setState werden automatisch neu angelegt/aktualisiert
- Bei Problemen "log"-Ausgaben im Skriptmonitor kontrollieren!
*************************************/
