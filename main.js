// === HP ILO 4 Version 2.81
// === Script zum Auslesen der Serverwerte
// === Lucifor 1976 im Juni 2025

// === KONFIGURATION ===
const iloIP   = 'DEINEILOIPHIER'; // ILO IP
const iloUser = 'ILOBENUTZERNAME'; // ILO Benutzer
const iloPass = 'ILOPASSWORTHIER'; // ILO Passwort

const telegramInstance = 'telegram.0'; // Telegraminstanz für Benachrichtigungen
const telegramUser     = 'TELEGRAMNUTZER'; // Nutzer für Benachrichtigungen
const alexaDP          = 'alexa2.0.Echo-Devices.XXXXXXXXXXXXXXX.Commands.speak'; // Echo Device für Critical Ansangen

const tempLimitCPU     = 70;
const dpPrefix         = 'javascript.0.ilo4-testing.'; // Datenpunkt unter der die Werte angelegt werden sollen

const axios = require('axios');
const https = require('https');

function sanitizeId(raw) {
    return raw
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+$/g, '')
        .replace(/^_+/, '')
        .replace(/\.+$/, '');
}

const agent = new https.Agent({ rejectUnauthorized: false });
const headers = {
    'Authorization': 'Basic ' + Buffer.from(`${iloUser}:${iloPass}`).toString('base64'),
    'Accept': 'application/json'
};

// === Temperatur & Lüfter
async function fetchThermal() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Chassis/1/Thermal`, { headers, httpsAgent: agent });
        const data = res.data;
        log('Thermal-Daten erfolgreich abgerufen.', 'info');

        if (Array.isArray(data.Temperatures)) {
            data.Temperatures.forEach(temp => {
                if (temp.CurrentReading > 0) {
                    const name = sanitizeId(temp.Name);
                    const dp = dpPrefix + 'temperatures.' + name;

                    createState(dp, 0, {
                        name: temp.PhysicalContext,
                        unit: '°C',
                        type: 'number',
                        role: 'value.temperature',
                        read: true,
                        write: false
                    }, () => {
                        setState(dp, temp.CurrentReading, true);
                    });

                    if (temp.PhysicalContext.includes('CPU') && temp.CurrentReading > tempLimitCPU) {
                        sendTo(telegramInstance, {
                            user: telegramUser,
                            text: `⚠️ Achtung! CPU-Temperatur "${temp.Name}" = ${temp.CurrentReading} °C (Grenze: ${tempLimitCPU} °C)`
                        });
                        setState(alexaDP, {
                            val: `Achtung! Die Temperatur der ${temp.Name} beträgt ${temp.CurrentReading} Grad.`,
                            ack: false
                        });
                    }
                }
            });
        }

        if (Array.isArray(data.Fans)) {
            data.Fans.forEach(fan => {
                const name = sanitizeId(fan.FanName);
                const dp = dpPrefix + 'fans.' + name;

                createState(dp, 0, {
                    name: 'Fan Speed',
                    unit: '%',
                    type: 'number',
                    role: 'value.speed',
                    read: true,
                    write: false
                }, () => {
                    setState(dp, fan.CurrentReading, true);
                });
            });
        }

    } catch (error) {
        log(`Fehler beim Abrufen der Thermal-Daten: ${error.message}`, 'error');
    }
}

// === Systeminformationen
async function fetchSystemInfo() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Systems/1`, { headers, httpsAgent: agent });
        const sys = res.data;
        const map = {
            Model: sys.Model,
            SerialNumber: sys.SerialNumber,
            BIOSVersion: sys.Bios?.Current?.VersionString
        };
        for (const [key, val] of Object.entries(map)) {
            const dp = dpPrefix + 'system.' + sanitizeId(key);
            createState(dp, '', { name: key, type: 'string', role: 'text', read: true, write: false }, () => {
                setState(dp, val, true);
            });
        }
    } catch (e) {
        log(`Systeminfo-Fehler: ${e.message}`, 'error');
    }
}

// === Energie inkl. PSU Status
async function fetchPower() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Chassis/1/Power`, { headers, httpsAgent: agent });
        const pwr = res.data;

        // DEBUG
        log('Power-Datenstruktur: ' + JSON.stringify(pwr, null, 2), 'debug');

        // Verbrauch in Watt
        const watts = pwr.PowerControl?.[0]?.PowerConsumedWatts;
        if (typeof watts === 'number' && watts > 0) {
            const dpPower = dpPrefix + 'power.PowerConsumedWatts';
            createState(dpPower, 0, {
                name: 'Verbrauch', unit: 'W', type: 'number', role: 'value.power', read: true, write: false
            }, () => {
                setState(dpPower, watts, true);
            });
        } else {
            log('PowerConsumedWatts nicht verfügbar oder = 0.', 'warn');
        }

        // Netzteil-Zustand mit Überwachung
        if (Array.isArray(pwr.PowerSupplies)) {
            pwr.PowerSupplies.forEach((psu, index) => {
                const prefix = dpPrefix + `power.PSU_${index + 1}`;
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
                    }, () => {
                        setState(dp, val, true);
                    });
                }

                if (health !== 'OK' || state !== 'Enabled') {
                    const meldung = `⚠️ Netzteil PSU ${index + 1} meldet Status: ${status}`;
                    sendTo(telegramInstance, { user: telegramUser, text: meldung });
                    setState(alexaDP, { val: `Achtung! Netzteil ${index + 1} hat den Status ${status} erreicht.`, ack: false });
                }
            });
        } else {
            log('⚠️ Keine PowerSupplies gefunden oder falsches Format.', 'warn');
        }

    } catch (e) {
        log(`Power-Fehler: ${e.message}`, 'error');
    }
}

// === Firmware
async function fetchFirmware() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Managers/1`, { headers, httpsAgent: agent });
        const fw = res.data;
        const map = {
            iLOFirmwareVersion: fw.Firmware?.Current?.VersionString,
            iLODate: fw.Firmware?.Current?.Date
        };
        for (const [key, val] of Object.entries(map)) {
            const dp = dpPrefix + 'firmware.' + sanitizeId(key);
            createState(dp, '', { name: key, type: 'string', role: 'text', read: true, write: false }, () => {
                setState(dp, val, true);
            });
        }
    } catch (e) {
        log(`Firmware-Fehler: ${e.message}`, 'error');
    }
}

// === Netzwerk
async function fetchNetwork() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Managers/1/EthernetInterfaces/1`, { headers, httpsAgent: agent });
        const net = res.data;
        const map = {
            MACAddress: net.MACAddress,
            IPv4: net.IPv4?.[0]?.Address
        };
        for (const [key, val] of Object.entries(map)) {
            const dp = dpPrefix + 'network.' + sanitizeId(key);
            createState(dp, '', { name: key, type: 'string', role: 'text', read: true, write: false }, () => {
                setState(dp, val, true);
            });
        }
    } catch (e) {
        log(`Netzwerk-Fehler: ${e.message}`, 'error');
    }
}

// === BIOS-Settings
async function fetchBios() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Systems/1/Bios/Settings`, { headers, httpsAgent: agent });
        const bios = res.data;

        let dumpText = '🧬 BIOS-Felder:\n';

        for (const [key, val] of Object.entries(bios)) {
            try {
                const dp = dpPrefix + 'bios.' + sanitizeId(key);
                const valueType = typeof val === 'boolean' ? 'boolean' :
                                  (typeof val === 'number' ? 'number' : 'string');

                // Optional Log-Ausgabe
                dumpText += `• ${key}: ${val}\n`;

                createState(dp, '', {
                    name: key,
                    type: valueType,
                    role: 'text',
                    read: true,
                    write: false
                }, () => {
                    try {
                        setState(dp, val, true);
                    } catch (e) {
                        log(`⚠️ setState-Fehler bei BIOS-Feld "${key}": ${e.message}`, 'warn');
                    }
                });

            } catch (e) {
                log(`⚠️ createState-Fehler bei BIOS-Feld "${key}": ${e.message}`, 'warn');
            }
        }

        // Ausgabe ins Log
        log(dumpText, 'info');

        // Optional auch als Textdatenpunkt
        const dumpDP = dpPrefix + 'bios.__dump';
        createState(dumpDP, '', {
            name: 'Alle BIOS-Werte (Text)',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        }, () => {
            setState(dumpDP, dumpText.trim(), true);
        });

        log('BIOS-Settings erfolgreich abgerufen.', 'info');

    } catch (e) {
        if (e.response?.status === 404) {
            log('BIOS-Settings-API wird von dieser iLO-Version nicht unterstützt.', 'warn');
        } else {
            log(`BIOS-Fehler: ${e.message}`, 'error');
        }
    }
}

// === Festplatten (optional, wird abgefangen bei 404)
async function fetchDisks() {
    try {
        const res = await axios.get(`https://${iloIP}/rest/v1/Systems/1/SmartStorage/ArrayControllers/0/PhysicalDrives`, {
            headers,
            httpsAgent: agent
        });

        if (!res.data || !Array.isArray(res.data.Members)) {
            log('Keine Festplattendaten verfügbar oder API nicht unterstützt.', 'warn');
            return;
        }

        const drives = res.data.Members;

        for (let i = 0; i < drives.length; i++) {
            const driveUrl = drives[i]['@odata.id'];
            const detail = await axios.get(`https://${iloIP}${driveUrl}`, {
                headers,
                httpsAgent: agent
            });

            const d = detail.data;
            const prefix = dpPrefix + `disks.Drive_${i + 1}`;

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
                }, () => {
                    setState(dp, val, true);
                });
            }
        }

    } catch (e) {
        if (e.response?.status === 404) {
            log('Festplatten-API wird von dieser iLO-Version nicht unterstützt.', 'warn');
        } else {
            log(`Festplatten-Fehler: ${e.message}`, 'error');
        }
    }
}

// === Hauptausführung
async function readILO() {
    await fetchThermal();
    await fetchSystemInfo();
    await fetchPower();
    await fetchFirmware();
    await fetchNetwork();
    await fetchBios();
    await fetchDisks();
}

// === Start & Intervall
readILO();
schedule('*/2 * * * *', readILO); // Abfrageintervall = 2 Minuten
