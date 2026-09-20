// generate-hash.js
const bcrypt = require('bcryptjs');

const plainPassword = 'admin123'; // pwede mo palitan kung gusto mo ibang password

bcrypt.hash(plainPassword, 10).then((hash) => {
  console.log('Password:', plainPassword);
  console.log('Hash:', hash);
});