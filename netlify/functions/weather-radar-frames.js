// Netlify Function: RainViewer radar frame metadata proxy.
// Returns recent past frames + nowcast for forward-in-time animation.
// Animation timeline: -60m → -50m → ... → Now → +10m → +20m
// No API key required.

export async function handler() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) {
      return {statusCode: 502, body: JSON.stringify({error: 'rainviewer_error'})};
    }
    const data = await res.json();
    const past = data.radar?.past || [];
    const nowcast = data.radar?.nowcast || [];
    const frames = [
      ...past.map((f) => ({time: f.time, path: f.path})),
      ...nowcast.map((f) => ({time: f.time, path: f.path})),
    ];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
      body: JSON.stringify({host: data.host, radar: frames}),
    };
  } catch (e) {
    console.error('weather-radar-frames error:', e);
    return {statusCode: 500, body: JSON.stringify({error: 'internal'})};
  }
}
