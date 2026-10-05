const fs = require('fs');
let content = fs.readFileSync('src/screens/WelcomeScreen.tsx', 'utf8');
content = content.replace(
  "bizName = data.businesses?.name || bizName;",
  "bizName = Array.isArray(data.businesses) ? data.businesses[0]?.name : (data.businesses as any)?.name || bizName;"
);
fs.writeFileSync('src/screens/WelcomeScreen.tsx', content);
