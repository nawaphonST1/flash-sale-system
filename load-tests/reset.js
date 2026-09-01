const http = require('http');

const options = {
  hostname: 'localhost',
  port: 80,
  path: '/api/v1/admin/reset',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

console.log('Sending reset request to http://localhost/api/v1/admin/reset ...');

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Response status: ' + res.statusCode);
    try {
      console.log('Response body:', JSON.stringify(JSON.parse(data), null, 2));
    } catch {
      console.log('Response body:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Problem with request: ' + e.message);
});

req.end();
