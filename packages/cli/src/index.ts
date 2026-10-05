import { Command } from 'commander';
import { createDomain } from './commands/create';
import { certifyDomain } from './commands/certify';

const program = new Command();

program
  .name('plugos')
  .description('ThePlugOS Developer CLI')
  .version('1.0.0');

program
  .command('create')
  .description('Create a new resource')
  .argument('<type>', 'Type of resource (domain)')
  .argument('<name>', 'Name of the resource')
  .action((type, name) => {
    if (type === 'domain') {
      createDomain(name);
    } else {
      console.error(`Unknown resource type: ${type}`);
    }
  });

program
  .command('certify')
  .description('Run certification framework against a domain')
  .argument('[path]', 'Path to the domain package', '.')
  .action((path) => {
    certifyDomain(path);
  });

program.parse(process.argv);
