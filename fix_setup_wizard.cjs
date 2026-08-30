const fs = require('fs');
let content = fs.readFileSync('src/screens/FirstTimeSetupWizard.tsx', 'utf8');
content = content.replace(
  "id: `prod-${Date.now()}`,\n      name: newItemName,",
  "id: `prod-${Date.now()}`,\n      name: newItemName,\n      description: newItemName,"
);
fs.writeFileSync('src/screens/FirstTimeSetupWizard.tsx', content);
