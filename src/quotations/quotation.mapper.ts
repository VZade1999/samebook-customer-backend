import { UpdateQuotationDto } from './dto/updateQuotation.dto';

export class QuotationMapper {
  static buildUpdatePayload(data: UpdateQuotationDto, currentVersion: number) {
    return {
      ...(data.customer_id !== undefined && {
        customer_id: data.customer_id,
      }),

      ...(data.contact_person_id !== undefined && {
        contact_person_id: data.contact_person_id,
      }),

      ...(data.billing_address_id !== undefined && {
        billing_address_id: data.billing_address_id,
      }),

      ...(data.shipping_address_id !== undefined && {
        shipping_address_id: data.shipping_address_id,
      }),

      ...(data.customer_name !== undefined && {
        customer_name: data.customer_name,
      }),

      ...(data.customer_type !== undefined && {
        customer_type: data.customer_type as 'INDIVIDUAL' | 'BUSINESS',
      }),

      ...(data.customer_gst_number !== undefined && {
        customer_gst_number: data.customer_gst_number,
      }),

      ...(data.contact_person_name !== undefined && {
        contact_person_name: data.contact_person_name,
      }),

      ...(data.contact_person_email !== undefined && {
        contact_person_email: data.contact_person_email,
      }),

      ...(data.contact_person_phone !== undefined && {
        contact_person_phone: data.contact_person_phone,
      }),

      ...(data.billing_address_snapshot !== undefined && {
        billing_address_snapshot: (() => {
          try {
            if (typeof data.billing_address_snapshot === 'string') {
              return JSON.parse(data.billing_address_snapshot);
            }
            return data.billing_address_snapshot ?? null;
          } catch (e) {
            return null;
          }
        })(),
      }),

      ...(data.shipping_address_snapshot !== undefined && {
        shipping_address_snapshot: (() => {
          try {
            if (typeof data.shipping_address_snapshot === 'string') {
              return JSON.parse(data.shipping_address_snapshot);
            }
            return data.shipping_address_snapshot ?? null;
          } catch (e) {
            return null;
          }
        })(),
      }),

      ...(data.quotation_date && {
        quotation_date: new Date(data.quotation_date),
      }),

      ...(data.validity_date && {
        validity_date: new Date(data.validity_date),
      }),

      ...(data.status !== undefined && {
        status: data.status,
      }),

      ...(data.notes !== undefined && {
        notes: data.notes,
      }),

      ...(data.terms_conditions !== undefined && {
        terms_conditions: data.terms_conditions,
      }),

      ...(data.place_of_supply_state_id !== undefined && {
        place_of_supply_state_id: data.place_of_supply_state_id,
      }),

      ...(data.sub_total !== undefined && {
        sub_total: data.sub_total,
      }),

      ...(data.discount_percent !== undefined && {
        discount_percent: data.discount_percent,
      }),

      ...(data.discount_amount !== undefined && {
        discount_amount: data.discount_amount,
      }),

      ...(data.cgst_percent !== undefined && {
        cgst_percent: data.cgst_percent,
      }),

      ...(data.cgst_amount !== undefined && {
        cgst_amount: data.cgst_amount,
      }),

      ...(data.sgst_percent !== undefined && {
        sgst_percent: data.sgst_percent,
      }),

      ...(data.sgst_amount !== undefined && {
        sgst_amount: data.sgst_amount,
      }),

      ...(data.igst_percent !== undefined && {
        igst_percent: data.igst_percent,
      }),

      ...(data.igst_amount !== undefined && {
        igst_amount: data.igst_amount,
      }),

      ...(data.transport_charges !== undefined && {
        transport_charges: data.transport_charges,
      }),

      ...(data.grand_total !== undefined && {
        grand_total: data.grand_total,
      }),

      version_number: currentVersion + 1,

      updated_by: data.user_id,
    };
  }
}
