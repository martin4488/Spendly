export interface Category {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  subcategories?: Category[];
}

export interface Expense {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number;
  description: string;
  notes: string | null;
  date: string;
  is_recurring: boolean;
  recurring_id: string | null;
  original_currency: string | null;
  original_amount: number | null;
  created_at: string;
  updated_at: string;
  category?: Category;
}

export interface RecurringExpense {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number;
  description: string;
  notes: string | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  day_of_month: number;
  is_active: boolean;
  end_date: string | null;
  last_generated: string | null;
  created_at: string;
  updated_at: string;
  category?: Category;
}

export interface Budget {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string;
  recurrence: 'monthly' | 'yearly';
  start_date: string;
  created_at: string;
  updated_at: string;
  category_ids?: string[];
  categories?: Category[];
  spent?: number;
}

export interface BudgetCategory {
  id: string;
  budget_id: string;
  category_id: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  default_currency: 'EUR' | 'USD' | 'ARS';
}

export interface MonthlyTotal {
  month: string;
  total: number;
}

export interface CategorySpending {
  category_id: string;
  category_name: string;
  category_icon: string;
  category_color: string;
  spent: number;
  budget: number;
  percentage: number;
}
