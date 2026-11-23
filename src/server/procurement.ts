import type { PurchaseOrder } from '../shared.ts'

export const vendors = [
  { id: 'V-101', name: 'Northstar Office Supply', aliases: ['Northstar Office Supply LLC', 'Northstar Office Supplies'] },
  { id: 'V-102', name: 'Harborline Packaging', aliases: ['Harborline Packaging Inc'] },
  { id: 'V-103', name: 'Cedarline Facilities', aliases: ['Cedarline Facilities LLC'] },
]

export const purchaseOrders: PurchaseOrder[] = [
  { id: 'PO-1042', vendor: 'V-101', description: 'Office and print supplies', limit: 180000, committed: 26000, currency: 'USD', status: 'open' },
  { id: 'PO-2081', vendor: 'V-102', description: 'Quarterly packaging order', limit: 150000, committed: 35000, currency: 'USD', status: 'open' },
  { id: 'PO-3106', vendor: 'V-103', description: 'Main office maintenance', limit: 90000, committed: 12000, currency: 'USD', status: 'open' },
  { id: 'PO-3107', vendor: 'V-103', description: 'Warehouse maintenance', limit: 85000, committed: 8000, currency: 'USD', status: 'open' },
  { id: 'PO-0990', vendor: 'V-101', description: 'Prior office supplies contract', limit: 90000, committed: 90000, currency: 'USD', status: 'closed' },
]

export const normalized = (value: string | null) =>
  value?.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''

export function findVendor(name: string | null) {
  const key = normalized(name)
  return vendors.find(vendor => [vendor.name, ...vendor.aliases].some(alias => normalized(alias) === key))
}
