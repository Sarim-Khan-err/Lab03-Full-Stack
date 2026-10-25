const { createApp } = require('./app');
const mode = process.argv[2] === 'student' ? 'student' : 'shop';
const port = Number(process.env.PORT || (mode === 'student' ? 3004 : 3005));
createApp({ mode }).listen(port, () => console.log(`${mode} API: http://localhost:${port}`));
