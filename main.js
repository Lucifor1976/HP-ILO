
 // === KONFIGURATION ===
const iloIP   = 'DEINEILOIPHIER';      // iLO IP-Adresse
const iloUser = 'ILOBENUTZER';      // iLO Benutzername
const iloPass = 'ILOPASSWORT';       // iLO Passwort
 
const telegramInstance = 'telegram.0'; // Telegram-Adapter-Instanz
const telegramUser     = 'TELEGRAMUSER';    // Telegram-Zielnutzer
 
const tempLimitCPU     = 70;           // CPU-Warnschwelle für Telegrambenachrichtigung
const dpPrefix         = 'javascript.0.ilo4xxx.'; // ggf Anpassen
const pollInterval     = 1 * 60 * 1000; // alle 1 Minuten
 
// === MODULE
const axios = require('axios');
const https = require('https');
 
// === Hilfsfunktion: saubere ID-Namen
function sanitizeId(raw) {
    return raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+$/g, '').replace(/^_+/, '');
}
 
// === iLO Daten abfragen
function readILO() {
    const url = `https://${iloIP}/rest/v1/Chassis/1/Thermal`;
    const authHeader = 'Basic ' + Buffer.from(`${iloUser}:${iloPass}`).toString('base64');
 
    axios.get(url, {
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false // <- Ignoriere selbstsigniertes Zertifikat
        }),
        timeout: 10000
    }).then(response => {
        const data = response.data;
        log('iLO-Daten erfolgreich abgerufen.', 'info');
 
        // === Temperaturen
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
 
                    // === Telegram-Warnung bei CPU
                    if (temp.PhysicalContext.includes('CPU') && temp.CurrentReading > tempLimitCPU) {
                        sendTo(telegramInstance, {
                            user: telegramUser,
                            text: `⚠️ Achtung! CPU-Temperatur "${temp.Name}" = ${temp.CurrentReading} °C (Grenze: ${tempLimitCPU} °C)`
                        });
                    }
                }
            });
        }
 
        // === Lüfterdaten
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
 
    }).catch(error => {
        log(`Fehler beim Abrufen der iLO-Daten: ${error.message}`, 'error');
    });
}
 
// === Erstaufruf + Intervall
readILO();
schedule('*/2 * * * *', readILO); // alle 2 Minuten
