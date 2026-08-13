import { describe, expect, it } from 'vitest';
import { validateSupportTicket } from '../../validators/support';

describe('support ticket validation', () => {
  it('trims and accepts valid content', () => {
    const result = validateSupportTicket('  Falha no treino  ', '  A tela fecha ao iniciar o treino.  ');
    expect(result).toMatchObject({ subject: 'Falha no treino', subjectValid: true, messageValid: true });
  });
  it('rejects short content', () => {
    expect(validateSupportTicket('Oi', 'Pouco').subjectValid).toBe(false);
    expect(validateSupportTicket('Oi', 'Pouco').messageValid).toBe(false);
  });
});
