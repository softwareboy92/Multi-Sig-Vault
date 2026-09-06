import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout";
import { PageSkeleton } from "./components/ui";

// Static imports — first paint & lightweight fallback
import { EntryPage } from "./pages/EntryPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// Lazy-loaded page chunks
const WalletPage = lazy(() => import("./pages/WalletPage").then(m => ({ default: m.WalletPage })));
const CreateWalletPage = lazy(() => import("./pages/CreateWalletPage").then(m => ({ default: m.CreateWalletPage })));
const WalletImportPage = lazy(() => import("./pages/WalletImportPage").then(m => ({ default: m.WalletImportPage })));
const WalletDetailPage = lazy(() => import("./pages/WalletDetailPage").then(m => ({ default: m.WalletDetailPage })));
const WalletAssetsPage = lazy(() => import("./pages/WalletAssetsPage").then(m => ({ default: m.WalletAssetsPage })));
const DashboardPage = lazy(() => import("./pages/AssetsPage").then(m => ({ default: m.DashboardPage })));
const AssetDetailPage = lazy(() => import("./pages/AssetDetailPage").then(m => ({ default: m.AssetDetailPage })));
const AddressPage = lazy(() => import("./pages/AddressPage").then(m => ({ default: m.AddressPage })));
const SignatureAddressPage = lazy(() => import("./pages/SignatureAddressPage").then(m => ({ default: m.SignatureAddressPage })));
const SignatureAddressDetailPage = lazy(() => import("./pages/SignatureAddressDetailPage").then(m => ({ default: m.SignatureAddressDetailPage })));
const SignatureAddressVerifyPage = lazy(() => import("./pages/SignatureAddressVerifyPage").then(m => ({ default: m.SignatureAddressVerifyPage })));
const HistoryPage = lazy(() => import("./pages/HistoryPage").then(m => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage").then(m => ({ default: m.TransactionsPage })));
const TransactionDetailPage = lazy(() => import("./pages/TransactionDetailPage").then(m => ({ default: m.TransactionDetailPage })));
const EVMNetworksPage = lazy(() => import("./pages/EVMNetworksPage").then(m => ({ default: m.EVMNetworksPage })));
const BTCNetworksPage = lazy(() => import("./pages/BTCNetworksPage").then(m => ({ default: m.BTCNetworksPage })));
const SendTransactionPage = lazy(() => import("./pages/SendTransactionPage").then(m => ({ default: m.SendTransactionPage })));

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/welcome" element={<EntryPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/wallet/create" element={<CreateWalletPage />} />
          <Route path="/wallet/import" element={<WalletImportPage />} />
          <Route path="/wallet/:id" element={<WalletDetailPage />} />
          <Route path="/wallet/:id/assets" element={<WalletAssetsPage />} />
          <Route path="/wallet/:id/send" element={<SendTransactionPage />} />
          <Route path="/assets" element={<Navigate to="/dashboard" replace />} />
          <Route path="/assets/:groupKey" element={<AssetDetailPage />} />
          <Route path="/address" element={<AddressPage />} />
          <Route path="/signer" element={<SignatureAddressPage />} />
          <Route path="/signer/import" element={<Navigate to="/signer" replace />} />
          <Route path="/signer/:id/verify" element={<SignatureAddressVerifyPage />} />
          <Route
            path="/signer/:id"
            element={<SignatureAddressDetailPage />}
          />
          <Route path="/transactions" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/networks/evm" element={<EVMNetworksPage />} />
          <Route path="/settings/networks/btc" element={<BTCNetworksPage />} />
          <Route path="/wallet/:id/transactions" element={<TransactionsPage />} />
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
