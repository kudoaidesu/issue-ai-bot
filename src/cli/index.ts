import { runSetup } from './setup.js'

const command = process.argv[2]

switch (command) {
  case 'setup':
    await runSetup()
    break
  default:
    console.log('Issue AI Bot CLI')
    console.log('')
    console.log('Usage:')
    console.log('  npx tsx src/cli/index.ts setup    初期設定ウィザード')
    console.log('  npm run dev                       開発モード起動')
    console.log('  npm run start                     本番起動')
    break
}
