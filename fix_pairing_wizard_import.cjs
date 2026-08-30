const fs = require('fs');
let content = fs.readFileSync('src/components/DevicePairingWizard.tsx', 'utf8');
content = content.replace(
  "import {",
  "import { KeyRound,"
);
fs.writeFileSync('src/components/DevicePairingWizard.tsx', content);
