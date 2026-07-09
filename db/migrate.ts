import { db, closeDb } from '../src/shared/db.js';

const [, , command, arg] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case 'up': {
      const [batch, log] = await db.migrate.latest();
      console.log(`Migrated to batch ${batch}:`, log.length ? log.join(', ') : '(already up to date)');
      break;
    }
    case 'down': {
      const [batch, log] = await db.migrate.rollback();
      console.log(`Rolled back batch ${batch}:`, log.length ? log.join(', ') : '(nothing to roll back)');
      break;
    }
    case 'make': {
      if (!arg) throw new Error('Usage: npm run migrate:make -- <name>');
      const file = await db.migrate.make(arg);
      console.log(`Created migration: ${file}`);
      break;
    }
    default:
      throw new Error(`Unknown migrate command "${command}". Use one of: up, down, make.`);
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exitCode = 1;
  });
