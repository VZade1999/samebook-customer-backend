import 'reflect-metadata'; // the abilities import request DTOs (class-validator decorators)
import {
  chatTitle,
  decisionBlock,
  fitJson,
  indianPhone,
  inr,
  maskAccount,
  parseSettings,
  periodRange,
  permissionLabel,
  pickArgs,
  recordLink,
  seesMoney,
  settingsFrom,
  suggestionsFor,
  toolBlock,
  usageToday,
} from './ai-agent.rules';
import { AI_TOOLS, TOOL_BY_NAME, declaredArgs } from './tools/registry';

describe('AI Assistant rules', () => {
  const caller = (permissions: string[], allowChanges = true, modules = ['billing']) => ({ permissions, modules, allowChanges });

  it('names permissions the way the Roles page does', () => {
    expect(permissionLabel('customers.delete')).toBe('Delete customers');
    expect(permissionLabel('invoices.insides')).toBe('Invoice insights');
    expect(permissionLabel('stock.manage')).toBe('Manage stock');
  });

  it('blocks an ability without its permission, an add-on, or when changes are off', () => {
    const del = { permissions: ['customers.delete'], kind: 'confirm' as const };
    expect(toolBlock(del, caller(['customers.view']))).toMatch(/Delete customers/);
    expect(toolBlock(del, caller(['customers.delete']))).toBeNull();
    expect(toolBlock(del, caller(['customers.delete'], false))).toMatch(/look things up only/);
    expect(toolBlock({ permissions: ['customers.view'], kind: 'read' }, caller(['customers.view'], false))).toBeNull();
    expect(toolBlock({ permissions: [], kind: 'read', module: 'crm' }, caller([]))).toMatch(/add-on/);
    expect(toolBlock({ permissions: [], kind: 'read', module: 'crm' }, caller([], true, ['billing', 'crm']))).toBeNull();
  });

  it('money totals need invoices.view and invoices.insides, like the Dashboard', () => {
    expect(seesMoney(['invoices.view'])).toBe(false);
    expect(seesMoney(['invoices.view', 'invoices.insides'])).toBe(true);
  });

  it('only the person who asked can confirm, and only while it waits', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const a = { status: 'PENDING', user_id: 5, expires_at: '2026-11-23T12:20:00Z' };
    expect(decisionBlock(a, 5, now)).toBeNull();
    expect(decisionBlock(a, 6, now)).toMatch(/Only the person who asked/);
    expect(decisionBlock({ ...a, status: 'DONE' }, 5, now)).toMatch(/already done/);
    expect(decisionBlock({ ...a, expires_at: '2026-11-23T11:59:00Z' }, 5, now)).toMatch(/expired/);
    expect(decisionBlock({ ...a, expires_at: '2026-11-23 11:59:00' }, 5, now)).toMatch(/expired/);
  });

  it('names a chat after its first line', () => {
    expect(chatTitle('  Show unpaid invoices\nfor this month')).toBe('Show unpaid invoices');
    expect(chatTitle('', 'po-4512.pdf')).toBe('Document: po-4512.pdf');
    expect(chatTitle('')).toBe('New chat');
    const long = chatTitle('Create a quotation for Sharma Traders with ten MCB 32A and five rolls of 2.5 mm wire');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
  });

  it('turns named periods into dates (weeks from Monday, India’s April year)', () => {
    expect(periodRange('this_month', '2026-11-23')).toEqual({ from: '2026-11-01', to: '2026-11-23' });
    expect(periodRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('this_week', '2026-11-23')).toEqual({ from: '2026-11-23', to: '2026-11-23' }); // a Monday
    expect(periodRange('last_week', '2026-11-25')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodRange('this_financial_year', '2027-02-10')).toEqual({ from: '2026-04-01', to: '2027-02-10' });
    expect(periodRange('last_financial_year', '2026-11-23')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(periodRange('this_quarter', '2026-11-23')).toEqual({ from: '2026-10-01', to: '2026-11-23' });
    expect(periodRange('last_quarter', '2026-05-02')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRange('nonsense', '2026-11-23')).toBeNull();
  });

  it('keeps only declared arguments, so identity can never come from the AI', () => {
    expect(pickArgs(['id', 'name'], { id: 3, name: 'X', company_id: 9, user_id: 1, extra: true })).toEqual({ id: 3, name: 'X' });
    expect(pickArgs(['id'], null)).toEqual({});
    expect(pickArgs(['id'], [1, 2])).toEqual({});
  });

  it('reads Indian mobile numbers the way the customer form accepts them', () => {
    expect(indianPhone('+91 98765-43210')).toBe('9876543210');
    expect(indianPhone('09876543210')).toBe('9876543210');
    expect(indianPhone('12345')).toBeNull();
    expect(indianPhone('5876543210')).toBeNull();
  });

  it('formats rupees in Indian style and masks account numbers', () => {
    expect(inr(125000)).toBe('₹1,25,000');
    expect(inr(125000.5)).toBe('₹1,25,000.50');
    expect(maskAccount('123456789012')).toBe('••••9012');
  });

  it('cuts long lists before they reach the AI, saying how many were left out', () => {
    const big = { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Product number ${i}` })) };
    const text = fitJson(big, 2000);
    expect(text.length).toBeLessThanOrEqual(2000);
    const back = JSON.parse(text);
    expect(back.rows.length).toBeLessThan(400);
    expect(back.rows.length + back.rows_not_shown).toBe(400);
  });

  it('settings: defaults, limits and validation', () => {
    expect(settingsFrom(null)).toEqual({ allow_changes: true, daily_limit: 100 });
    expect(settingsFrom({ allow_changes: 0, daily_limit: 25 })).toEqual({ allow_changes: false, daily_limit: 25 });
    expect(parseSettings({ daily_limit: 0 })).toMatchObject({ ok: false });
    expect(parseSettings({ allow_changes: 'yes' })).toMatchObject({ ok: false });
    expect(parseSettings({ allow_changes: false, daily_limit: 40 })).toEqual({ ok: true, value: { allow_changes: false, daily_limit: 40 } });
    expect(usageToday(100, 100)).toMatchObject({ left: 0, blocked: true });
    expect(usageToday(3, 100)).toMatchObject({ left: 97, blocked: false });
  });

  it('suggests only what the person may see and do', () => {
    const sales = suggestionsFor(['dashboard.view', 'quotations.view', 'quotations.create', 'customers.view'], true).map((s) => s.title);
    expect(sales).toContain('Make a quotation');
    expect(sales).not.toContain('Who owes us money?');
    expect(sales).not.toContain('How is this month going?');
    const lookOnly = suggestionsFor(['quotations.view', 'quotations.create'], false).map((s) => s.title);
    expect(lookOnly).not.toContain('Make a quotation');
    expect(recordLink('quotation', 42)).toBe('/app/quotation?open=42');
  });
});

describe('AI Assistant abilities', () => {
  it('have unique names, a permission each, and the arguments they declare', () => {
    const names = AI_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of AI_TOOLS) {
      expect(t.permissions.length).toBeGreaterThan(0);
      expect(t.parameters.type).toBe('object');
      expect(t.description.length).toBeLessThan(450);
      for (const r of t.parameters.required || []) expect(declaredArgs(t)).toContain(r);
      // Identity is never an argument.
      expect(declaredArgs(t)).not.toEqual(expect.arrayContaining(['company_id']));
      expect(declaredArgs(t)).not.toEqual(expect.arrayContaining(['user_id']));
    }
  });

  it('ask for Confirm before anything risky', () => {
    const confirm = AI_TOOLS.filter((t) => t.kind === 'confirm').map((t) => t.name);
    for (const n of [
      'delete_customer',
      'archive_product',
      'receive_stock',
      'move_stock',
      'count_stock',
      'send_quotation',
      'approve_quotation',
      'close_quotation',
      'delete_quotation',
      'dispatch_challan',
      'deliver_challan',
      'record_payment',
      'update_company',
    ]) {
      expect(confirm).toContain(n);
      expect(typeof TOOL_BY_NAME.get(n)!.prepare).toBe('function');
    }
    // Look-ups never change anything.
    for (const t of AI_TOOLS.filter((x) => x.kind === 'read')) expect(t.name).toMatch(/^(find_|list_|business_|stock_|.*_details$)/);
  });

  it('need the same permission as the matching page', () => {
    const need = (n: string) => TOOL_BY_NAME.get(n)!.permissions;
    expect(need('delete_customer')).toEqual(['customers.delete']);
    expect(need('approve_quotation')).toEqual(['quotations.send']);
    expect(need('receive_stock')).toEqual(['stock.manage']);
    expect(need('record_payment')).toEqual(['invoices.edit']);
    expect(need('dispatch_challan')).toEqual(['challans.dispatch']);
    expect(need('business_overview')).toEqual(['dashboard.view']);
    expect(need('list_warehouses')).toEqual(['warehouses.view']);
  });
});
