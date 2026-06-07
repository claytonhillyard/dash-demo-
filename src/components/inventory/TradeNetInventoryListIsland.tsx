"use client";

import { useState } from "react";
import type { SharedInventoryRow } from "@/db/inventory";
import type { InventoryBidView } from "@/db/inventoryBids";
import { TradeNetInventoryList } from "./TradeNetInventoryList";
import { InventoryBidsTab } from "./InventoryBidsTab";
import {
  postInventoryBid,
  acceptInventoryBid,
  rejectInventoryBid,
  withdrawInventoryBid,
} from "@/lib/inventory/actions";

export function TradeNetInventoryListIsland({
  items, circleNamesById, viewerOrgId, bidsByItemId,
}: {
  items: SharedInventoryRow[];
  circleNamesById: Map<number, string>;
  viewerOrgId: number;
  bidsByItemId: Map<number, InventoryBidView[]>;
}) {
  const [open, setOpen] = useState<SharedInventoryRow | null>(null);
  return (
    <>
      <TradeNetInventoryList
        items={items}
        circleNamesById={circleNamesById}
        viewerOrgId={viewerOrgId}
        bidsByItemId={bidsByItemId}
        onPlaceBid={(it) => setOpen(it)}
      />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4">
          <div className="w-full max-w-lg">
            <InventoryBidsTab
              inventoryItem={{
                id: open.id,
                name: open.name,
                ownerOrgId: open.orgId,
                bidMode: open.bidMode,
                quantity: open.quantity,
                status: open.status,
              }}
              viewerOrgId={viewerOrgId}
              bids={bidsByItemId.get(open.id) ?? []}
              actions={{
                postInventoryBid,
                acceptInventoryBid,
                rejectInventoryBid,
                withdrawInventoryBid,
              }}
              onClose={() => setOpen(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
