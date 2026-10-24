import { createBrowserRouter, Navigate } from 'react-router';
import { AuditPage } from '@/features/audit/audit-page';
import { LoginPage } from '@/features/auth/login-page';
import { BackupsPage } from '@/features/backups/backups-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { BillingPage } from '@/features/billing/billing-page';
import { CashPage } from '@/features/cash/cash-page';
import { CatalogPage } from '@/features/catalog/catalog-page';
import { CustomerDetailPage, CustomersPage } from '@/features/customers/customers-page';
import { ExpensesPage } from '@/features/expenses/expenses-page';
import { LabelsPage } from '@/features/labels/labels-page';
import { PurchaseEditorPage, PurchasesPage } from '@/features/purchases/purchases-page';
import { SuppliersPage } from '@/features/purchases/suppliers-page';
import { NewReturnPage, ReturnsPage } from '@/features/returns/returns-page';
import { ProductEditorPage } from '@/features/products/product-editor-page';
import { ProductsPage } from '@/features/products/products-page';
import { SalesPage } from '@/features/sales/sales-page';
import { ReceiptStudioPage } from '@/features/receipt-studio/studio-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { UsersPage } from '@/features/users/users-page';
import { AppLayout } from './app-layout';
import { HomeRedirect, NotFound, RequireAuth, RequirePermission } from './guards';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },
          {
            element: <RequirePermission permission="reports.view" />,
            children: [
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'reports', element: <ReportsPage /> },
            ],
          },
          {
            element: <RequirePermission permission="audit.view" />,
            children: [{ path: 'audit', element: <AuditPage /> }],
          },
          {
            element: <RequirePermission permission="backups.manage" />,
            children: [{ path: 'backups', element: <BackupsPage /> }],
          },
          {
            element: <RequirePermission permission="sales.create" />,
            children: [{ path: 'billing', element: <BillingPage />, handle: { fullBleed: true } }],
          },
          {
            element: <RequirePermission permission="sales.view" />,
            children: [{ path: 'sales', element: <SalesPage /> }],
          },
          {
            element: <RequirePermission permission="returns.create" />,
            children: [
              { path: 'returns', element: <ReturnsPage /> },
              { path: 'returns/new', element: <NewReturnPage /> },
            ],
          },
          {
            element: <RequirePermission permission="customers.manage" />,
            children: [
              { path: 'customers', element: <CustomersPage /> },
              { path: 'customers/:id', element: <CustomerDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission="cash.register" />,
            children: [{ path: 'cash', element: <CashPage /> }],
          },
          {
            element: <RequirePermission permission="expenses.manage" />,
            children: [{ path: 'expenses', element: <ExpensesPage /> }],
          },
          {
            element: <RequirePermission permission="purchases.manage" />,
            children: [
              { path: 'purchases', element: <PurchasesPage /> },
              { path: 'purchases/:id', element: <PurchaseEditorPage /> },
              { path: 'suppliers', element: <SuppliersPage /> },
            ],
          },
          {
            element: <RequirePermission permission="products.view" />,
            children: [
              { path: 'products', element: <ProductsPage /> },
              { path: 'products/:id', element: <ProductEditorPage /> },
              { path: 'catalog', element: <CatalogPage /> },
              // Stock lives with the products now (low stock filter, Stock and Adjust buttons).
              { path: 'stock', element: <Navigate to="/products?low=1" replace /> },
              { path: 'labels', element: <LabelsPage /> },
            ],
          },
          {
            element: <RequirePermission permission="users.manage" />,
            children: [{ path: 'users', element: <UsersPage /> }],
          },
          {
            element: <RequirePermission permission="settings.manage" />,
            children: [
              { path: 'settings', element: <SettingsPage /> },
              {
                path: 'settings/receipt',
                element: <ReceiptStudioPage />,
                handle: { fullBleed: true },
              },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
