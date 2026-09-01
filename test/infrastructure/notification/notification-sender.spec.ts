import { readFileSync } from 'node:fs';
import type { HoldAvailableNotice } from '../../../src/application/ports/notification-sender.port.js';
import {
  LoggingNotificationSender,
  forgiving,
} from '../../../src/infrastructure/notification/logging-notification-sender.js';

const notice: HoldAvailableNotice = {
  memberId: 'm1',
  titleId: 't1',
  copyId: 'c1',
  pickupBy: new Date('2026-02-01T10:00:00Z'),
};

describe('Port de notification', () => {
  it('le port ne depend d aucun paquet tiers', () => {
    const source = readFileSync('src/application/ports/notification-sender.port.ts', 'utf8');
    const imports = [...source.matchAll(/^\s*import\s[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.filter((path) => !path.startsWith('.'))).toEqual([]);
  });

  it('l adaptateur ecrit dans le journal et rien d autre', async () => {
    const written: string[] = [];
    await new LoggingNotificationSender((line) => written.push(line)).holdAvailable(notice);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('m1');
    expect(written[0]).toContain('t1');
  });

  it('n appelle aucun fournisseur externe', () => {
    const source = readFileSync(
      'src/infrastructure/notification/logging-notification-sender.ts',
      'utf8',
    );
    expect(source).not.toMatch(/fetch\(|https?:\/\/|axios|nodemailer|sendgrid/i);
  });

  it('un echec de l adaptateur ne remonte pas a l appelant', async () => {
    const failing = {
      holdAvailable: (): Promise<void> => Promise.reject(new Error('SMTP injoignable')),
    };
    const written: string[] = [];
    await expect(forgiving(failing, (line) => written.push(line)).holdAvailable(notice)).resolves
      .toBeUndefined();
  });

  it('mais l echec est trace, jamais avale en silence', async () => {
    const failing = {
      holdAvailable: (): Promise<void> => Promise.reject(new Error('SMTP injoignable')),
    };
    const written: string[] = [];
    await forgiving(failing, (line) => written.push(line)).holdAvailable(notice);
    expect(written.join(' ')).toContain('SMTP injoignable');
  });
});
