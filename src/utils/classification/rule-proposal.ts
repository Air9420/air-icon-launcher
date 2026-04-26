import { defineStore } from "pinia";
import { ref } from "vue";
import { createVersionedPersistConfig } from "../../utils/versioned-persist";
import type { CategoryKey } from "./types";
import type { ProposedRule } from "./pattern-discovery";
import { CATEGORY_RULES } from "./rules";
import { EXE_MAP } from "./exe-map";

export type RuleProposal = {
    id: string;
    rule: ProposedRule;
    status: "pending" | "approved" | "rejected";
    createdAt: number;
    reviewedAt: number | null;
};

export type CustomRules = {
    publisherKeywords: Record<string, string[]>;
    exeMappings: Record<string, CategoryKey>;
    keywords: Record<string, string[]>;
};

const MAX_PROPOSALS = 50;

export const useRuleProposalStore = defineStore(
    "ruleProposal",
    () => {
        const proposals = ref<RuleProposal[]>([]);
        const customRules = ref<CustomRules>({
            publisherKeywords: {},
            exeMappings: {},
            keywords: {},
        });

        function addProposal(rule: ProposedRule): void {
            const id = `${rule.type}:${rule.value}:${rule.categoryKey}:${Date.now()}`;
            const existing = proposals.value.find(
                p => p.rule.type === rule.type && p.rule.value === rule.value && p.rule.categoryKey === rule.categoryKey
            );
            if (existing) {
                existing.rule = rule;
                return;
            }

            proposals.value.unshift({
                id,
                rule,
                status: "pending",
                createdAt: Date.now(),
                reviewedAt: null,
            });

            if (proposals.value.length > MAX_PROPOSALS) {
                proposals.value = proposals.value.slice(0, MAX_PROPOSALS);
            }
        }

        function approveProposal(proposalId: string): void {
            const proposal = proposals.value.find(p => p.id === proposalId);
            if (!proposal || proposal.status !== "pending") return;

            proposal.status = "approved";
            proposal.reviewedAt = Date.now();

            applyRule(proposal.rule);
        }

        function rejectProposal(proposalId: string): void {
            const proposal = proposals.value.find(p => p.id === proposalId);
            if (!proposal || proposal.status !== "pending") return;

            proposal.status = "rejected";
            proposal.reviewedAt = Date.now();
        }

        function applyRule(rule: ProposedRule): void {
            switch (rule.type) {
                case "publisher": {
                    const existing = customRules.value.publisherKeywords[rule.categoryKey] || [];
                    if (!existing.includes(rule.value)) {
                        customRules.value.publisherKeywords[rule.categoryKey] = [...existing, rule.value];
                    }
                    const categoryRule = CATEGORY_RULES.find(r => r.key === rule.categoryKey);
                    if (categoryRule) {
                        if (!categoryRule.publisherKeywords) categoryRule.publisherKeywords = [];
                        if (!categoryRule.publisherKeywords.includes(rule.value)) {
                            categoryRule.publisherKeywords.push(rule.value);
                        }
                    }
                    break;
                }
                case "exe": {
                    customRules.value.exeMappings[rule.value] = rule.categoryKey;
                    EXE_MAP[rule.value] = rule.categoryKey;
                    break;
                }
                case "keyword": {
                    const existing = customRules.value.keywords[rule.categoryKey] || [];
                    if (!existing.includes(rule.value)) {
                        customRules.value.keywords[rule.categoryKey] = [...existing, rule.value];
                    }
                    const categoryRule = CATEGORY_RULES.find(r => r.key === rule.categoryKey);
                    if (categoryRule) {
                        if (!categoryRule.keywords) categoryRule.keywords = [];
                        if (!categoryRule.keywords.includes(rule.value)) {
                            categoryRule.keywords.push(rule.value);
                        }
                    }
                    break;
                }
            }
        }

        function loadCustomRulesIntoEngine(): void {
            for (const [categoryKey, keywords] of Object.entries(customRules.value.publisherKeywords)) {
                const rule = CATEGORY_RULES.find(r => r.key === categoryKey);
                if (rule) {
                    if (!rule.publisherKeywords) rule.publisherKeywords = [];
                    for (const kw of keywords) {
                        if (!rule.publisherKeywords.includes(kw)) {
                            rule.publisherKeywords.push(kw);
                        }
                    }
                }
            }

            for (const [exeName, categoryKey] of Object.entries(customRules.value.exeMappings)) {
                EXE_MAP[exeName] = categoryKey;
            }

            for (const [categoryKey, keywords] of Object.entries(customRules.value.keywords)) {
                const rule = CATEGORY_RULES.find(r => r.key === categoryKey);
                if (rule) {
                    if (!rule.keywords) rule.keywords = [];
                    for (const kw of keywords) {
                        if (!rule.keywords.includes(kw)) {
                            rule.keywords.push(kw);
                        }
                    }
                }
            }
        }

        const pendingProposals = () => proposals.value.filter(p => p.status === "pending");

        return {
            proposals,
            customRules,
            addProposal,
            approveProposal,
            rejectProposal,
            applyRule,
            loadCustomRulesIntoEngine,
            pendingProposals,
        };
    },
    {
        persist: createVersionedPersistConfig("ruleProposal", [
            "proposals",
            "customRules",
        ]),
    }
);
