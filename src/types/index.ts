export interface Category {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  budget_amount: number;
  budget_period: 'monthly' | 'yearly';
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
  last_generated: string | null;
  created_at: string;
  updated_at: string;
  category?: Category;
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
