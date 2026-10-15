import type { Metadata } from "next";
import { CheckoutForm } from "@/components/shop/checkout-form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return <div className="mx-auto max-w-shop px-4 sm:px-6"><CheckoutForm /></div>;
}
