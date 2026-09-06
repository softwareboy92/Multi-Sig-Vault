export interface GuideStep {
  target: string;
  titleKey: string;
  descriptionKey: string;
  placement: "right" | "bottom";
}

export const tourSteps: GuideStep[] = [
  { target: "sidebar-brand", titleKey: "guide.step1Title", descriptionKey: "guide.step1Desc", placement: "right" },
  { target: "sidebar-nav-wallet", titleKey: "guide.step2Title", descriptionKey: "guide.step2Desc", placement: "right" },
  { target: "sidebar-nav-signatureAddress", titleKey: "guide.step3Title", descriptionKey: "guide.step3Desc", placement: "right" },
  { target: "sidebar-nav-dashboard", titleKey: "guide.step4Title", descriptionKey: "guide.step4Desc", placement: "right" },
  { target: "sidebar-nav-history", titleKey: "guide.step5Title", descriptionKey: "guide.step5Desc", placement: "right" },
  { target: "sidebar-nav-address", titleKey: "guide.step6Title", descriptionKey: "guide.step6Desc", placement: "right" },
  { target: "sidebar-nav-settings", titleKey: "guide.step7Title", descriptionKey: "guide.step7Desc", placement: "right" },
  { target: "topbar-sync", titleKey: "guide.step8Title", descriptionKey: "guide.step8Desc", placement: "bottom" },
  { target: "topbar-todo", titleKey: "guide.step9Title", descriptionKey: "guide.step9Desc", placement: "bottom" },
];
