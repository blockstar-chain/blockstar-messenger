import { Toaster } from "react-hot-toast";
import "./globals.css";
import WalletProvider from "@/utils/wagmiprovider";
import { cookieToInitialState } from "wagmi";
import { config } from "@/utils/wagmi";




export default function RootLayout({ children }) {
  const initialState = cookieToInitialState(config, undefined);
  return (
    <html lang="en">
      <body>
        <Toaster position="top-center" />
        <WalletProvider initialState={initialState}>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
