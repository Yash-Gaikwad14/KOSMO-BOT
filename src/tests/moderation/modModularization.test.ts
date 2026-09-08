import { data, execute, MAX_PURGE_AMOUNT, handleModerationButton } from '../../commands/moderation/mod';
import * as path from 'path';
import { loadCommands } from '../../commands/loader';

describe('H-01 Modularization Structural & Delegation Integrity', () => {
  test('mod.ts maintains singular command registration structure with all 8 subcommands', () => {
    expect(data.name).toBe('mod');
    expect(data.description).toBeDefined();

    const subcommands = data.options.map((opt: any) => opt.name);
    expect(subcommands).toEqual(
      expect.arrayContaining(['timeout', 'kick', 'ban', 'purge', 'warn', 'strike', 'history', 'case'])
    );
    expect(subcommands).toHaveLength(8);
  });

  test('loader discovers and loads /mod command correctly from filesystem', async () => {
    const commandsRoot = path.resolve(__dirname, '../../commands');
    const loaded = await loadCommands(commandsRoot);
    expect(loaded.has('mod')).toBe(true);
    const entry = loaded.get('mod');
    expect(entry?.data.name).toBe('mod');
    expect(typeof entry?.default).toBe('function');
  });

  test('exports MAX_PURGE_AMOUNT and handleModerationButton with exact contracts', () => {
    expect(MAX_PURGE_AMOUNT).toBe(100);
    expect(typeof handleModerationButton).toBe('function');
    expect(typeof execute).toBe('function');
  });
});
