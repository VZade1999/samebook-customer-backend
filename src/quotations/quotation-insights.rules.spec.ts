import {
  buildSummary,
  closeBlocker,
  closeReasonLabel,
  daysBetween,
  lastMonthToDate,
  parseClose,
  reopenBlocker,
  reopenStatus,
  monthKeys,
  parseListFilter,
  parseSort,
  summaryWindow,
} from './quotation-insights.rules';

describe('quotation insights rules', () => {
  it('month keys run oldest first and cross the year boundary', () => {
    expect(monthKeys('2026-11-13')).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(monthKeys('2026-02-01', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('summary window starts on the first of the oldest month and looks 7 days ahead', () => {
    expect(summaryWindow('2026-11-13')).toMatchObject({ from: '2026-06-01', soon: '2026-11-20' });
    expect(summaryWindow('2026-12-28').soon).toBe('2027-01-04');
  });

  it('compares the month so far with the same days of last month', () => {
    expect(lastMonthToDate('2026-11-13')).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(lastMonthToDate('2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(lastMonthToDate('2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-05' });
    expect(summaryWindow('2026-11-13')).toMatchObject({ prevFrom: '2026-10-01', prevTo: '2026-10-13' });
  });

  it('days between dates, negative once passed', () => {
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysBetween('2026-11-13', '2026-11-20')).toBe(7);
    expect(daysBetween('2026-11-13', '2026-11-01')).toBe(-12);
  });

  it('accepts only known filters and sorts', () => {
    expect(parseListFilter('approved')).toBe('APPROVED');
    expect(parseListFilter(' expiring ')).toBe('EXPIRING');
    expect(parseListFilter('DELETED')).toBeNull();
    expect(parseListFilter("SENT' OR 1=1")).toBeNull();
    expect(parseListFilter(undefined)).toBeNull();
    expect(parseSort('VALUE_HIGH')).toBe('value_high');
    expect(parseSort('created_at; drop')).toBe('newest');
  });

  describe('closing with feedback', () => {
    it('accepts an outcome with one of its reasons and trims the remark', () => {
      expect(parseClose({ outcome: 'rejected', reason: 'price', remark: '  Found it cheaper locally \r\n' })).toEqual({
        ok: true,
        outcome: 'REJECTED',
        reason: 'PRICE',
        remark: 'Found it cheaper locally',
      });
      expect(parseClose({ outcome: 'EXPIRED', reason: 'NO_RESPONSE' })).toEqual({ ok: true, outcome: 'EXPIRED', reason: 'NO_RESPONSE', remark: null });
    });
    it('rejects unknown outcomes, reasons from the other outcome, and long remarks', () => {
      expect(parseClose({ outcome: 'WON', reason: 'PRICE' })).toMatchObject({ ok: false });
      expect(parseClose({ outcome: 'EXPIRED', reason: 'PRICE' })).toMatchObject({ ok: false, message: 'Pick a reason for closing' });
      expect(parseClose({ outcome: 'REJECTED', reason: 'PRICE', remark: 'x'.repeat(1001) })).toMatchObject({ ok: false });
    });
    it('"Other" needs a remark', () => {
      expect(parseClose({ outcome: 'REJECTED', reason: 'OTHER', remark: ' ' })).toMatchObject({ ok: false, message: 'Add a remark explaining why it was closed' });
      expect(parseClose({ outcome: 'REJECTED', reason: 'OTHER', remark: 'Customer shut the site' })).toMatchObject({ ok: true });
    });
    it('only open, un-invoiced quotations can be closed; only closed ones reopened', () => {
      expect(closeBlocker({ status: 'DRAFT' })).toBeNull();
      expect(closeBlocker({ status: '' })).toBeNull();
      expect(closeBlocker({ status: 'APPROVED' })).toBeNull();
      expect(closeBlocker({ status: 'APPROVED', has_invoice: 1 })).toMatch(/invoice/);
      expect(closeBlocker({ status: 'EXPIRED' })).toMatch(/already closed/);
      expect(closeBlocker({ status: 'PARTIALLY_DISPATCHED' })).toMatch(/dispatched/);
      expect(closeBlocker({ status: 'DELETED' })).toMatch(/not found/);
      expect(reopenBlocker({ status: 'REJECTED' })).toBeNull();
      expect(reopenBlocker({ status: 'SENT' })).toMatch(/Only a closed/);
      expect(reopenBlocker({ status: 'EXPIRED', has_invoice: true })).toMatch(/invoice/);
    });
    it('reopening restores the open status it had, else draft', () => {
      expect(reopenStatus('SENT')).toBe('SENT');
      expect(reopenStatus('APPROVED')).toBe('APPROVED');
      expect(reopenStatus('')).toBe('DRAFT');
      expect(reopenStatus('REJECTED')).toBe('DRAFT');
      expect(reopenStatus(undefined)).toBe('DRAFT');
    });
    it('labels reasons per outcome', () => {
      expect(closeReasonLabel('REJECTED', 'COMPETITOR')).toBe('Went with a competitor');
      expect(closeReasonLabel('EXPIRED', 'COMPETITOR')).toBeNull();
    });
  });

  describe('buildSummary', () => {
    const base = {
      today: '2026-11-13',
      prevToDate: { n: '8', v: '4000' },
      stageRows: [
        { stage: 'draft', n: '10', v: '1000.5', lapsed_n: 3, lapsed_v: 300, soon_n: 1, soon_v: 100, pipe_n: 0, pipe_v: 0 },
        { stage: 'sent', n: 4, v: 4000, lapsed_n: 1, lapsed_v: 50, soon_n: 2, soon_v: 900, pipe_n: 3, pipe_v: 3950 },
        { stage: 'approved', n: 6, v: 6000, lapsed_n: 0, lapsed_v: 0, soon_n: 0, soon_v: 0, pipe_n: 6, pipe_v: 6000 },
        { stage: 'invoiced', n: 5, v: 9000 },
        { stage: 'rejected', n: 1, v: 10 },
        { stage: 'weird', n: 2, v: 5 },
      ],
      monthRows: [
        { m: '2026-10', n: 8, v: 4000, inv_n: 2, inv_v: 1000 },
        { m: '2026-11', n: 10, v: 6000, inv_n: 1, inv_v: 500 },
        { m: '2025-01', n: 99, v: 99, inv_n: 0, inv_v: 0 },
      ],
      expiringRows: [
        { id: '7', quotation_number: 'QT/1', customer_name: null, validity_date: '2026-11-15', grand_total: '120.456', stage: 'sent' },
      ],
      customerRows: [{ id: null, name: 'Walk-in', n: '3', v: '300', won: '100' }],
    };
    const s = buildSummary(base);

    it('totals every stage; unknown stages count as drafts', () => {
      expect(s.stages.draft).toEqual({ count: 12, value: 1005.5 });
      expect(s.stages.expired).toEqual({ count: 0, value: 0 });
      expect(s.total).toEqual({ count: 28, value: 20015.5 });
      expect(s.open).toEqual({ count: 22, value: 11005.5 });
    });

    it('pipeline, lapsed and expiring come from the open rows', () => {
      expect(s.pipeline).toEqual({ count: 9, value: 9950 });
      expect(s.lapsed).toEqual({ count: 4, value: 350 });
      expect(s.expiring).toMatchObject({ days: 7, count: 3, value: 1000 });
      expect(s.expiring.items[0]).toEqual({
        id: 7,
        quotation_number: 'QT/1',
        customer_name: '—',
        validity_date: '2026-11-15',
        days_left: 2,
        grand_total: 120.46,
        stage: 'sent',
      });
    });

    it('rates: invoiced share of all, accepted share of what was shared', () => {
      expect(s.win_rate).toBe(17.9); // 5 / 28
      expect(s.acceptance_rate).toBe(68.8); // (6 + 5) / (4 + 6 + 5 + 1)
      expect(s.avg_value).toBe(714.84);
    });

    it('six months, zero-filled, with the month so far against the same days of last month', () => {
      expect(s.months.map((m) => m.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
      expect(s.months[0]).toEqual({ key: '2026-06', count: 0, value: 0, invoiced_count: 0, invoiced_value: 0 });
      expect(s.this_month).toEqual({ count: 10, value: 6000, from: '2026-11-01', to: '2026-11-13' });
      expect(s.last_month).toEqual({ count: 8, value: 4000, from: '2026-10-01', to: '2026-10-13' });
      expect(s.count_change).toBe(25);
      expect(s.value_change).toBe(50);
    });

    it('top customers keep a missing id as null', () => {
      expect(s.top_customers).toEqual([{ id: null, name: 'Walk-in', count: 3, value: 300, invoiced_value: 100 }]);
    });

    it('close reasons are labelled and ordered by how often they happen', () => {
      const c = buildSummary({
        ...base,
        closedRows: [
          { outcome: 'EXPIRED', reason: 'NO_RESPONSE', n: 1, v: 50 },
          { outcome: 'REJECTED', reason: 'PRICE', n: '3', v: '900' },
          { outcome: 'REJECTED', reason: null, n: 1, v: 10 },
        ],
      });
      expect(c.close_reasons.map((r) => [r.label, r.count])).toEqual([
        ['Price too high', 3],
        ['No response from the customer', 1],
        ['No reason given', 1],
      ]);
      expect(s.close_reasons).toEqual([]);
    });

    it('an empty company has no rates instead of 0%', () => {
      const e = buildSummary({ today: '2026-11-13', stageRows: [], monthRows: [], expiringRows: [], customerRows: [] });
      expect(e.total).toEqual({ count: 0, value: 0 });
      expect(e.win_rate).toBeNull();
      expect(e.acceptance_rate).toBeNull();
      expect(e.avg_value).toBe(0);
      expect(e.count_change).toBe(0);
    });
  });
});
