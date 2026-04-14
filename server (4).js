require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Disable caching in development
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/map-image', async (req, res) => {
  try {
    const { address } = req.body;
    const geo = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: process.env.GOOGLE_MAPS_KEY }
    });
    const { lat, lng } = geo.data.results[0].geometry.location;
    const img = await axios.get('https://maps.googleapis.com/maps/api/staticmap', {
      params: { center: `${lat},${lng}`, zoom: 19, size: '600x400', maptype: 'satellite', key: process.env.GOOGLE_MAPS_KEY },
      responseType: 'arraybuffer'
    });
    const b64 = Buffer.from(img.data).toString('base64');
    res.json({ image: b64, lat, lng });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/analyze', async (req, res) => {
  try {
    const { base64, mime, prompt } = req.body;
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-opus-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    const raw = response.data.content.map(b => b.text || '').join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('LawnQuote server running on http://localhost:3001'));
