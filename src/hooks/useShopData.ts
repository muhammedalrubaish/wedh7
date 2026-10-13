import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import type {
  Category,
  Customer,
  Invoice,
  Part,
  PurchaseBill,
  PurchaseItem,
  PurchaseOrder,
  ReturnNote,
  StockMovement,
  Supplier,
} from '@/lib/types'

const EMPTY: never[] = []

export const useParts = (): Part[] =>
  useLiveQuery(() => db.parts.toArray(), [], EMPTY as unknown as Part[])

export const useActiveParts = (): Part[] =>
  useLiveQuery(() => db.parts.filter((p) => !p.archived).toArray(), [], EMPTY as unknown as Part[])

export const useCategories = (): Category[] =>
  useLiveQuery(() => db.categories.toArray(), [], EMPTY as unknown as Category[])

export const useSuppliers = (): Supplier[] =>
  useLiveQuery(() => db.suppliers.toArray(), [], EMPTY as unknown as Supplier[])

export const useCustomers = (): Customer[] =>
  useLiveQuery(() => db.customers.toArray(), [], EMPTY as unknown as Customer[])

export const useInvoices = (): Invoice[] =>
  useLiveQuery(() => db.invoices.toArray(), [], EMPTY as unknown as Invoice[])

export const useReturns = (): ReturnNote[] =>
  useLiveQuery(() => db.returns.toArray(), [], EMPTY as unknown as ReturnNote[])

export const useMovements = (): StockMovement[] =>
  useLiveQuery(() => db.movements.toArray(), [], EMPTY as unknown as StockMovement[])

export const usePurchaseItems = (): PurchaseItem[] =>
  useLiveQuery(() => db.purchaseItems.toArray(), [], EMPTY as unknown as PurchaseItem[])

export const usePurchaseBills = (): PurchaseBill[] =>
  useLiveQuery(() => db.purchaseBills.toArray(), [], EMPTY as unknown as PurchaseBill[])

export const usePurchaseOrders = (): PurchaseOrder[] =>
  useLiveQuery(() => db.purchaseOrders.toArray(), [], EMPTY as unknown as PurchaseOrder[])

export function useLookup<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}
