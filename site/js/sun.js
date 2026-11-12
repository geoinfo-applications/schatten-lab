// Sun position after the NOAA solar calculator (Meeus, "Astronomical Algorithms"), good to about 0.01° in this century.
// Altitude is apparent (Bennett refraction, see below). Azimuth is from true north, clockwise.

const RAD = Math.PI / 180;

function julianCenturies(utcMs) {
    const jd = utcMs / 86400000 + 2440587.5;
    return (jd - 2451545) / 36525;
}

// Bennett's refraction for 10 °C and 1010 hPa, solved for the apparent altitude (the same model as skyfield's "standard").
function apparentAltitude(geometric) {
    if (geometric < -1.5 || geometric > 89.9) {
        return geometric;
    }
    let apparent = geometric;
    for (let i = 0; i < 8; i++) {
        const a = Math.max(-1, apparent);
        apparent = geometric + 0.016667 / Math.tan((a + 7.31 / (a + 4.4)) * RAD);
    }
    return apparent;
}

// Geometric (airless) altitude and azimuth in degrees for a UTC instant and a place.
export function sunGeometric(utcMs, lat, lon) {
    const T = julianCenturies(utcMs);
    const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
        + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
        + Math.sin(3 * M * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
    const y = Math.tan((eps / 2) * RAD) ** 2;
    const equationOfTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
        + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
        - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    const minutesUtc = (((utcMs / 60000) % 1440) + 1440) % 1440;
    const trueSolarMinutes = minutesUtc + equationOfTime + 4 * lon;
    const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
    const phi = lat * RAD;
    const sinAltitude = Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle);
    const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / RAD;
    const azimuth = Math.atan2(Math.sin(hourAngle),
        Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi)) / RAD + 180;
    return { altitude, azimuth: ((azimuth % 360) + 360) % 360 };
}

export function sunPosition(utcMs, lat, lon) {
    const geometric = sunGeometric(utcMs, lat, lon);
    return { altitude: apparentAltitude(geometric.altitude), azimuth: geometric.azimuth, geometric: geometric.altitude };
}

// Sunrise and sunset (geometric altitude -0.833°: upper limb with standard refraction) by bisection within one UTC day window.
export function sunriseSunset(dayStartUtcMs, lat, lon) {
    const crossing = (a, b) => {
        let low = a;
        let high = b;
        const rising = sunGeometric(a, lat, lon).altitude < -0.833;
        for (let i = 0; i < 40; i++) {
            const mid = (low + high) / 2;
            const above = sunGeometric(mid, lat, lon).altitude > -0.833;
            if (above === rising) {
                high = mid;
            } else {
                low = mid;
            }
        }
        return (low + high) / 2;
    };
    let noon = dayStartUtcMs;
    let best = -90;
    for (let m = 0; m < 1440; m += 10) {
        const altitude = sunGeometric(dayStartUtcMs + m * 60000, lat, lon).altitude;
        if (altitude > best) {
            best = altitude;
            noon = dayStartUtcMs + m * 60000;
        }
    }
    return { sunrise: crossing(dayStartUtcMs, noon), sunset: crossing(noon, dayStartUtcMs + 1440 * 60000), noon, maxAltitude: best };
}
