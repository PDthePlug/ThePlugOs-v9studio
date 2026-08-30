import * as fs from 'fs';
import * as path from 'path';

export function createDomain(name: string) {
  const dir = path.join(process.cwd(), name);
  if (fs.existsSync(dir)) {
    console.error(`Directory ${name} already exists.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });
  
  const manifest = {
    name,
    version: "1.0.0",
    description: `ThePlugOS domain for ${name}`,
    entities: [],
    workflows: [],
    rules: []
  };

  fs.writeFileSync(path.join(dir, 'plugos-manifest.json'), JSON.stringify(manifest, null, 2));
  
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(path.join(srcDir, 'index.ts'), `// Domain entry point\nexport const domain = "${name}";\n`);
  
  console.log(`Created domain ${name} successfully.`);
}
