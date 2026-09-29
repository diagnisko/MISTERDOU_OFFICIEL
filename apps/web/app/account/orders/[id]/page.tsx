"use client";

import { useParams } from "next/navigation";
import { OrderDetailView } from "@/components/account/order-detail";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return <OrderDetailView orderId={id} />;
}
