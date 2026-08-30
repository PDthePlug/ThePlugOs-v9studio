// Domain entry point
export const domain = "pharmacy-domain";

export const reducers = {
  prescription: (state: any, event: any) => {
    const s = state || { status: 'VERIFYING', medication: '', dosage: '', patientId: '' };
    if (event.action === 'PRESCRIPTION_RECEIVED') {
      s.medication = event.payload.medication;
      s.dosage = event.payload.dosage;
      s.patientId = event.payload.patientId;
      s.status = 'APPROVED';
    } else if (event.action === 'MEDICATION_DISPENSED') {
      s.status = 'FULFILLED';
    }
    return s;
  },
  inventory: (state: any, event: any) => {
    const s = state || { drug_id: event.entityId, stock: 50 };
    if (event.action === 'STOCK_ADJUSTED') {
      s.stock -= event.payload.amount;
    }
    return s;
  }
};
