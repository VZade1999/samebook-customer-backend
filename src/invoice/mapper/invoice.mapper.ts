export class InvoiceMapper {
  static buildInvoicePayload(
    quotation: any,
    invoiceNumber: string,
    sequenceData: any,
    generatedBy: number,
  ) {
    return {
      quotation_id: quotation.id,

      company_id: quotation.company_id,

      customer_id: quotation.customer_id,

      invoice_number: invoiceNumber,

      quotation_number:
        quotation.quotation_number,

      document_type: 'INV',

      daily_sequence:
        sequenceData.dailySequence,

      overall_sequence:
        sequenceData.overallSequence,

      invoice_date: new Date(),

      status: 'GENERATED',

      customer_name:
        quotation.customer_name,

      customer_type:
        quotation.customer_type,

      customer_gst_number:
        quotation.customer_gst_number,

      contact_person_name:
        quotation.contact_person_name,

      contact_person_email:
        quotation.contact_person_email,

      contact_person_phone:
        quotation.contact_person_phone,

      billing_address_snapshot:
        quotation.billing_address_snapshot,

      shipping_address_snapshot:
        quotation.shipping_address_snapshot,

      business_details_snapshot:
        quotation.business_details_snapshot,

      payment_details_snapshot:
        quotation.payment_details_snapshot,

      notes: quotation.notes,

      terms_conditions:
        quotation.terms_conditions,

      place_of_supply_state_id:
        quotation.place_of_supply_state_id,

      sub_total: quotation.sub_total,

      discount_percent:
        quotation.discount_percent,

      discount_amount:
        quotation.discount_amount,

      cgst_percent:
        quotation.cgst_percent,

      cgst_amount:
        quotation.cgst_amount,

      sgst_percent:
        quotation.sgst_percent,

      sgst_amount:
        quotation.sgst_amount,

      igst_percent:
        quotation.igst_percent,

      igst_amount:
        quotation.igst_amount,

      transport_charges:
        quotation.transport_charges,

      grand_total:
        quotation.grand_total,

      paid_amount: 0,

      balance_amount:
        quotation.grand_total,

      generated_by: generatedBy,
    };
  }
}