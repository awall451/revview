// Stand-in for a claude that prints something and exits: argv 2 = exit code, argv 3.. = lines to print (\e = ESC).
const code = Number(process.argv[2] ?? 1);
const text = process.argv.slice(3, Math.max(3, process.argv.indexOf('--session-id'))).join('\n').replaceAll('\\e', '\u001b');
process.stdout.write(`${text}\n`);
setTimeout(() => process.exit(code), 100);
