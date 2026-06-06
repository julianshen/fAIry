import type { ReactElement } from "react";
import type { ActionStyle, ChatLayout, FeedItem } from "../types";
import {
  MsgItem,
  ThinkingItem,
  HandoffItem,
  PlanItem,
  ActionsItem,
  ResultItem,
  ConfirmItem,
  TakeoverItem,
  UiItem,
} from "./FeedItems";
import { ProposalCard } from "./ProposalCard";

export interface FeedProps {
  items: FeedItem[];
  chat: ChatLayout;
  actionStyle: ActionStyle;
  onAnswer: (key: number, choice: string) => void;
  onTake: (key: number) => void;
  onToggleActions: (key: number) => void;
  onResolveProposal: (key: number, accept: boolean) => void;
}

/** The scrolling conversation/activity feed: routes each item to its renderer. */
export function Feed({
  items,
  chat,
  actionStyle,
  onAnswer,
  onTake,
  onToggleActions,
  onResolveProposal,
}: FeedProps): ReactElement {
  return (
    <div className="feed" data-chat={chat}>
      {items.map((it) => {
        switch (it.type) {
          case "user":
          case "say":
            return <MsgItem key={it.key} item={it} />;
          case "thinking":
            return <ThinkingItem key={it.key} item={it} />;
          case "handoff":
            return <HandoffItem key={it.key} item={it} />;
          case "plan":
            return <PlanItem key={it.key} item={it} />;
          case "actions":
            return (
              <ActionsItem
                key={it.key}
                item={it}
                actionStyle={actionStyle}
                onToggle={() => onToggleActions(it.key)}
              />
            );
          case "result":
            return <ResultItem key={it.key} item={it} />;
          case "ui":
            return <UiItem key={it.key} item={it} />;
          case "confirm":
            return <ConfirmItem key={it.key} item={it} onAnswer={(c) => onAnswer(it.key, c)} />;
          case "takeover":
            return <TakeoverItem key={it.key} item={it} onTake={() => onTake(it.key)} />;
          case "proposal":
            return (
              <ProposalCard
                key={it.key}
                proposal={it.proposal}
                resolved={it.resolved}
                onResolve={(accept) => onResolveProposal(it.key, accept)}
              />
            );
        }
      })}
    </div>
  );
}
