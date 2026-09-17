// Simulates Jest's own failure output for an unresolved path alias, without
// requiring a real Jest install in this fixture. Mirrors the blueprint's
// example UX exactly.
console.error("FAIL src/users.test.ts");
console.error("  Cannot find module '@/modules/users' from 'src/users.test.ts'");
process.exit(1);
