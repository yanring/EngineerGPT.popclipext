const https = require('https');
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
var postData = JSON.stringify({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: '你好！给我讲个笑话。' }],
});

var options = {
  hostname: 'oa.api2d.site',
  port: 443,
  path: '/v1/chat/completions',
  method: 'POST',
  proxy: {
    host: '127.0.0.1',
    port: 7890,
    protocol: 'https'
    },
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer fk217875-ktuKeXTGr3koZ6XxZVKz3src0OrsWGXN', // <-- 把 fkxxxxx 替换成你自己的 Forward Key，注意前面的 Bearer 要保留，并且和 Key 中间有一个空格。
  },
};

var req = https.request(options, (res) => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', res.headers);

  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.write(postData);
req.end();