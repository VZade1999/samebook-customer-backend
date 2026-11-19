import { adminProblem, cleanPrefix, companyNameProblem, prefixCandidates } from './tenant.rules';

describe('adding a company', () => {
  it('suggests a prefix from the name', () => {
    expect(prefixCandidates('Ek Plate Parcels').slice(0, 3)).toEqual(['EPP', 'EPP2', 'EPP3']);
    expect(prefixCandidates('Kalyani')[0]).toBe('KALY');
    expect(prefixCandidates('K.D. Electricals & Co')[0]).toBe('KDEC');
    expect(prefixCandidates('!!!')[0]).toBe('CO');
    expect(prefixCandidates('A B C D E F G H I J K L', 12).every((p) => p.length <= 10)).toBe(true);
  });

  it('cleans a typed prefix', () => {
    expect(cleanPrefix(' kd-01 ')).toBe('KD01');
    expect(cleanPrefix('abcdefghijklmn')).toBe('ABCDEFGHIJ');
  });

  it("checks the business name and the first Admin's details", () => {
    expect(companyNameProblem('')).toMatch(/business name/);
    expect(companyNameProblem('Ek Plate Parcels')).toBeNull();
    expect(adminProblem({ first_name: 'Asha', email: 'asha@shop.in', password: 'longenough' })).toBeNull();
    expect(adminProblem({ first_name: '', email: 'asha@shop.in', password: 'longenough' })).toMatch(/first name/);
    expect(adminProblem({ first_name: 'Asha', email: 'nope', password: 'longenough' })).toMatch(/valid email/);
    expect(adminProblem({ first_name: 'Asha', email: 'asha@shop.in', password: 'short' })).toMatch(/8 characters/);
  });
});
