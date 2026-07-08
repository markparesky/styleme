// Weather via Open-Meteo (free, no API key, CORS-enabled).
const WMO = [
  [0, '☀', 'Clear'], [1, '🌤', 'Mostly clear'], [2, '⛅', 'Partly cloudy'], [3, '☁', 'Overcast'],
  [45, '🌫', 'Fog'], [48, '🌫', 'Fog'],
  [51, '🌦', 'Drizzle'], [53, '🌦', 'Drizzle'], [55, '🌧', 'Drizzle'],
  [61, '🌧', 'Rain'], [63, '🌧', 'Rain'], [65, '🌧', 'Heavy rain'],
  [66, '🌧', 'Freezing rain'], [67, '🌧', 'Freezing rain'],
  [71, '🌨', 'Snow'], [73, '🌨', 'Snow'], [75, '🌨', 'Heavy snow'], [77, '🌨', 'Snow'],
  [80, '🌦', 'Showers'], [81, '🌧', 'Showers'], [82, '🌧', 'Heavy showers'],
  [85, '🌨', 'Snow showers'], [86, '🌨', 'Snow showers'],
  [95, '⛈', 'Thunderstorm'], [96, '⛈', 'Thunderstorm'], [99, '⛈', 'Thunderstorm'],
];

export function describeWmo(code) {
  let best = WMO[0];
  for (const row of WMO) if (code >= row[0]) best = row;
  return { icon: best[1], text: best[2] };
}

export async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not look up that place.');
  const json = await res.json();
  if (!json.results || !json.results.length) throw new Error(`No place found for "${query}".`);
  const r = json.results[0];
  return { name: r.name + (r.admin1 ? `, ${r.admin1}` : '') + (r.country_code ? ` (${r.country_code})` : ''), lat: r.latitude, lon: r.longitude };
}

// Returns array of { date, tMax, tMin, rainProb, code } in °F, up to 16 days
export async function forecast(lat, lon, days = 7, startDate = null) {
  let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=${Math.min(16, Math.max(1, days))}`;
  if (startDate) {
    const end = new Date(startDate);
    end.setDate(end.getDate() + days - 1);
    const fmt = d => d.toISOString().slice(0, 10);
    url = url.replace(/&forecast_days=\d+/, '') + `&start_date=${fmt(new Date(startDate))}&end_date=${fmt(end)}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather lookup failed.');
  const json = await res.json();
  const d = json.daily;
  return d.time.map((date, i) => ({
    date,
    tMax: Math.round(d.temperature_2m_max[i]),
    tMin: Math.round(d.temperature_2m_min[i]),
    rainProb: d.precipitation_probability_max ? d.precipitation_probability_max[i] : 0,
    code: d.weathercode[i],
  }));
}
