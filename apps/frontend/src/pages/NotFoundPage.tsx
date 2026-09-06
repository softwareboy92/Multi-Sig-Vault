import React from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, PageShell } from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <PageShell title="404">
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full text-center p-8">
          <div className="text-6xl font-bold text-[var(--muted)] mb-4">404</div>
          <p className="text-[var(--muted)] mb-6">{t("notFound.message")}</p>
          <Button onClick={() => navigate("/")}>{t("notFound.goHome")}</Button>
        </Card>
      </div>
    </PageShell>
  );
};
