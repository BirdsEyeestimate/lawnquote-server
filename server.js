require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');
const app = express();
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const LEADS_FILE = path.join(__dirname, 'leads.json');
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

app.post('/map-image', async (req, res) => {
  try {
    const { address } = req.body;
    const geo = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address, key: process.env.GOOGLE_MAPS_KEY } });
    const { lat, lng } = geo.data.results[0].geometry.location;
    const img = await axios.get('https://maps.googleapis.com/maps/api/staticmap', { params: { center: `${lat},${lng}`, zoom: 19, size: '600x400', maptype: 'satellite', key: process.env.GOOGLE_MAPS_KEY }, responseType: 'arraybuffer' });
    res.json({ image: Buffer.from(img.data).toString('base64'), lat, lng });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/analyze', async (req, res) => {
  try {
    const { base64, mime, prompt } = req.body;
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-opus-4-6', max_tokens: 500,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }, { type: 'text', text: prompt }] }]
    }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
    const raw = response.data.content.map(b => b.text || '').join('');
    res.json(JSON.parse(raw.replace(/```json|```/g, '').trim()));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/lead', async (req, res) => {
  try {
    const { name, email, phone, address, sqft } = req.body;
    console.log('\n NEW LEAD:', name, email, phone, address, sqft);
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) { try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch(e){} }
    leads.unshift({ name, email, phone, address, sqft, date: new Date().toISOString() });
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    let settings = {};
    if (fs.existsSync(SETTINGS_FILE)) { try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch(e){} }
    const bizName = settings.bizName || 'Your Lawn Care Provider';
    const chatLink = `http://localhost:3001/chat?name=${encodeURIComponent(name)}&address=${encodeURIComponent(address)}&sqft=${sqft}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`;
    if (email) {
      await resend.emails.send({
        from: 'quotes@birdseyeestimate.com',
        to: email,
        subject: `${bizName} — get your exact quote`,
        html: `<div style="font-family:sans-serif;max-width:480px"><h2 style="color:#27500A">Hi ${name}!</h2><p style="font-size:15px;color:#333;line-height:1.6">Thanks for requesting a quote! Click below to chat with our AI assistant and get your exact price.</p><a href="${chatLink}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#3B6D11;color:white;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">Get my exact quote →</a></div>`
      });
      console.log('Email sent to', email);
    }
    if (process.env.NOTIFY_EMAIL) {
      await resend.emails.send({
        from: 'quotes@birdseyeestimate.com',
        to: process.env.NOTIFY_EMAIL,
        subject: `🌿 New lead - ${name} - ${sqft} sqft`,
        html: `<div style="font-family:sans-serif;max-width:520px;padding:24px;background:#f9faf7;border-radius:12px">
<h2 style="color:#1e3a0f;margin-bottom:4px">🌿 New Quote Request</h2>
<p style="color:#6b7a64;font-size:13px;margin-bottom:20px">Submitted just now</p>
<div style="background:white;border:1px solid #d8e0d2;border-radius:10px;padding:16px;margin-bottom:16px">
<p style="margin:0 0 10px"><b style="color:#374030">Name:</b> ${name}</p>
<p style="margin:0 0 10px"><b style="color:#374030">Phone:</b> <a href="tel:${phone}" style="color:#3B6D11;font-weight:600">${phone}</a></p>
<p style="margin:0 0 10px"><b style="color:#374030">Email:</b> <a href="mailto:${email}" style="color:#3B6D11">${email}</a></p>
<p style="margin:0 0 10px"><b style="color:#374030">Address:</b> ${address}</p>
<p style="margin:0"><b style="color:#374030">Lawn size:</b> ${Number(sqft).toLocaleString()} sqft</p>
</div>
<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" style="display:inline-block;padding:10px 20px;background:#3B6D11;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-right:10px">📍 Open in Maps</a>
<a href="tel:${phone}" style="display:inline-block;padding:10px 20px;background:#1e3a0f;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">📞 Call Now</a>
</div>`
      });
    }
    res.json({ ok: true });
  } catch(err) { console.error('Lead error:', err.message); res.json({ ok: false }); }
});

app.post('/lead-qualified', async (req, res) => {
  try {
    const { name, email, phone, address, sqft, answers, finalPrice } = req.body;
    console.log('\n QUALIFIED LEAD:', name, finalPrice);
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) { try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch(e){} }
    const idx = leads.findIndex(l => l.email === email && l.address === address);
    if (idx > -1) { leads[idx] = { ...leads[idx], answers, finalPrice, qualified: true }; }
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    if (process.env.NOTIFY_EMAIL) {
      await resend.emails.send({
        from: 'quotes@birdseyeestimate.com',
        to: process.env.NOTIFY_EMAIL,
        subject: `🔥 QUALIFIED lead - ${name} - $${finalPrice}`,
        html: `<div style="font-family:sans-serif;max-width:520px;padding:24px;background:#f9faf7;border-radius:12px">
<h2 style="color:#1e3a0f;margin-bottom:4px">🔥 Qualified Lead — $${finalPrice}</h2>
<p style="color:#6b7a64;font-size:13px;margin-bottom:20px">This customer completed the AI chat and is ready to book</p>
<div style="background:white;border:1px solid #d8e0d2;border-radius:10px;padding:16px;margin-bottom:16px">
<p style="margin:0 0 10px"><b style="color:#374030">Name:</b> ${name}</p>
<p style="margin:0 0 10px"><b style="color:#374030">Phone:</b> <a href="tel:${phone}" style="color:#3B6D11;font-weight:600">${phone}</a></p>
<p style="margin:0 0 10px"><b style="color:#374030">Address:</b> ${address}</p>
<p style="margin:0 0 10px"><b style="color:#374030">Lawn size:</b> ${Number(sqft).toLocaleString()} sqft</p>
<p style="margin:0"><b style="color:#374030">Quoted price:</b> <span style="font-size:20px;font-weight:700;color:#3B6D11">$${finalPrice}</span></p>
</div>
<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" style="display:inline-block;padding:10px 20px;background:#3B6D11;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-right:10px">📍 Open in Maps</a>
<a href="tel:${phone}" style="display:inline-block;padding:10px 20px;background:#1e3a0f;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">📞 Call Now</a>
</div>`
      });
    }
    res.json({ ok: true });
  } catch(err) { res.json({ ok: false }); }
});

app.post('/settings', (req, res) => {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(req.body, null, 2)); res.json({ ok: true }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/settings', (req, res) => {
  try { res.json(fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) : {}); }
  catch(err) { res.json({}); }
});
app.get('/leads', (req, res) => {
  try { res.json(fs.existsSync(LEADS_FILE) ? JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')) : []); }
  catch(err) { res.json([]); }
});

app.listen(3001, () => console.log('LawnQuote server running on http://localhost:3001'));
