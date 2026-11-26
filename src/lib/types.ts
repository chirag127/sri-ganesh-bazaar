export interface Variant {
  id: string;
  product_id: string;
  label: string;
  weight_kg: number | null;
  unit_kind?: 'bag' | 'jar' | 'bottle' | 'piece' | 'pack';
  available: boolean;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  image_url: string | null;
  active: boolean;
  variants: Variant[];
}

export type PublicVariant = Omit<Variant, 'reference_price_paise'>;
export type PublicProduct = Omit<Product, 'variants'> & { variants: PublicVariant[] };

export interface AdminVariant extends Variant {
  reference_price_paise: number;
}
export interface AdminProduct extends Omit<Product, 'variants'> {
  variants: AdminVariant[];
}

export interface CatalogSnapshot {
  products: PublicProduct[];
  configured: boolean;
  generated_at?: string;
  stale?: boolean;
}

export type PhoneStatus = 'unverified' | 'sms_verified' | 'staff_confirmed';
export interface Customer {
  id: string;
  auth_user_id: string | null;
  name: string;
  phone: string | null;
  phone_status: PhoneStatus;
  email: string | null;
  address: string | null;
  created_at: string;
  balance_paise?: number;
  estimate_approved?: boolean;
}

export interface CartLine {
  variant_id: string;
  quantity: number;
}

export interface OrderLine extends CartLine {
  label: string;
}

export interface QuoteLine extends OrderLine {
  unit_price_paise: number;
}

export interface Quote {
  id: string;
  version: number;
  lines: QuoteLine[];
  goods_total_paise: number;
  transport_paise: number;
  total_paise: number;
  deposit_paise: number;
  expires_at: string;
  reservation_until: string | null;
  notes: string | null;
  credit_approved: boolean;
}

export type OrderStatus = 'enquiry' | 'quoted' | 'accepted' | 'ready' | 'dispatched' | 'completed' | 'cancelled';
export type Fulfillment = 'pickup' | 'own_driver' | 'shop_delivery';
export interface Order {
  id: string;
  number: string;
  customer_id: string;
  customer_name?: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  address: string | null;
  notes: string | null;
  lines: OrderLine[];
  quote: Quote | null;
  paid_paise: number;
  cash_collector: 'shop' | 'driver';
  driver_name: string | null;
  driver_phone: string | null;
  handover_mode?: 'paid' | 'credit' | 'cod' | null;
  handover_note?: string | null;
  cod_amount_paise?: number;
  goods_released_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  customer_id: string;
  order_id: string | null;
  kind: string;
  amount_paise: number;
  note: string;
  created_at: string;
  reversal_of?: string | null;
}

export interface InventoryRow {
  variant_id: string;
  product_name: string;
  label: string;
  on_hand: number;
  reserved: number;
  available: number;
  average_cost_paise: number;
  reorder_level: number;
  selling_paused?: boolean;
}

export interface Bill {
  id: string;
  number: string;
  order_id: string;
  customer_id: string;
  issued_at: string;
  total_paise: number;
  lines: QuoteLine[];
  transport_paise: number;
}

export interface PaymentSubmission {
  id: string;
  customer_id: string;
  order_id: string;
  amount_paise: number;
  reference: string;
  screenshot_path: string | null;
  status: 'pending' | 'verified' | 'rejected';
  created_at: string;
  reviewed_at?: string | null;
  review_note?: string | null;
}

export interface Receipt {
  id: string;
  number: string;
  customer_id: string;
  order_id: string | null;
  payment_id?: string | null;
  kind: 'payment' | 'refund';
  amount_paise: number;
  method: 'cash' | 'upi';
  reference: string | null;
  note?: string | null;
  received_by: 'shop' | 'driver';
  issued_at: string;
}

export interface DeletionRequest {
  id: string;
  customer_id: string;
  user_id?: string;
  reason: string | null;
  status: 'requested' | 'processing' | 'completed' | 'rejected';
  note: string | null;
  created_at: string;
  updated_at?: string;
}

export interface DriverCollection {
  id: string;
  order_id: string;
  customer_id: string;
  payment_id: string;
  driver_name: string;
  driver_phone?: string;
  amount_paise: number;
  remitted_paise: number;
  status: 'pending' | 'partial' | 'remitted';
  note?: string;
  created_at: string;
}

export interface ReturnRecord {
  id: string;
  order_id: string;
  customer_id: string;
  lines: Array<CartLine & { restock: boolean }>;
  amount_paise: number;
  note: string;
  created_at: string;
}

export interface RefundRequest {
  id: string;
  customer_id: string;
  order_id: string | null;
  amount_paise: number;
  status: string;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface Workspace {
  customer: Customer;
  orders: Order[];
  ledger: LedgerEntry[];
  bills: Bill[];
  is_admin: boolean;
  balance_paise: number;
  payment_submissions?: PaymentSubmission[];
  receipts?: Receipt[];
  deletion_requests?: DeletionRequest[];
  driver_collections?: DriverCollection[];
  returns?: ReturnRecord[];
  refund_requests?: RefundRequest[];
  phone_requests?: Array<{ id: string; status: string; created_at: string }>;
  pagination?: Record<string, { total: number; limit: number; offset: number }>;
}

export interface AdminWorkspace {
  customers: Customer[];
  orders: Order[];
  inventory: InventoryRow[];
  ledger: LedgerEntry[];
  bills: Bill[];
  admins: Array<{ user_id: string; email: string }>;
  products: AdminProduct[];
  payment_submissions?: PaymentSubmission[];
  receipts?: Receipt[];
  deletion_requests?: DeletionRequest[];
  driver_collections?: DriverCollection[];
  returns?: ReturnRecord[];
  refund_requests?: RefundRequest[];
  audit?: Array<{ id: string; action: string; actor_id?: string; created_at: string; details?: unknown }>;
  pagination?: Record<string, { total: number; limit: number; offset: number }>;
}

export interface CustomerDetail {
  customer: Customer;
  balance_paise: number;
  orders: Order[];
  ledger: LedgerEntry[];
  bills: Bill[];
  receipts: Receipt[];
  payment_submissions?: PaymentSubmission[];
  deletion_requests?: DeletionRequest[];
}

export interface OrderDetail {
  order: Order;
  customer?: Customer;
  balance_paise?: number;
  bills: Bill[];
  receipts: Receipt[];
  payment_submissions: PaymentSubmission[];
  returns?: ReturnRecord[];
  driver_collections?: DriverCollection[];
}

export type CommandName =
  | 'save_profile' | 'submit_enquiry' | 'accept_quote' | 'submit_payment'
  | 'cancel_order' | 'request_account_deletion' | 'save_product' | 'adjust_stock'
  | 'create_customer' | 'link_customer' | 'confirm_phone' | 'issue_quote'
  | 'accept_quote_for_customer' | 'record_payment' | 'set_fulfillment'
  | 'advance_order' | 'counter_sale' | 'record_return' | 'record_refund'
  | 'set_admin' | 'register_push' | 'unregister_push' | 'process_account_deletion'
  | 'expire_reservations' | 'record_remittance'
  | 'count_stock' | 'set_stock_availability' | 'set_reorder_level';

export interface CommandResult {
  id?: string;
  request_id?: string;
  [key: string]: unknown;
}
