import type { Metadata } from "next";
import { GeoEpiWorkspace } from "@/components/geoepi/geoepi-workspace";
import { PageHeader } from "@/components/page-header";
import {
  Alert,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { geoEpiLaunch } from "@/lib/geoepi/launch";

export const metadata: Metadata = { title: "Measles" };

/** The Director's questions, from the Group 3 commissioning brief. */
const QUESTIONS = [
  "Which districts show the strongest combination of case signals and immunisation gaps?",
  "Do age-specific case rates, MCV1/MCV2 coverage and dropout suggest different priorities from raw case counts?",
  "How would incomplete reporting or uncertain vaccination estimates alter the recommendations?",
];

const STEPS = [
  {
    module: "Upload",
    text: "Upload the measles pack (Measles.zip as it is) under Upload a dataset, named e.g. measles_data.",
  },
  {
    module: "M1",
    text: "Data preparation: raw DHIMS2-style exports to a checked district-month panel, with reporting, impossible-value and age-consistency checks.",
  },
  {
    module: "Hand-off",
    text: "On the finished M1 run, choose Use outputs as a dataset. M2 and the new dataset are selected for you.",
  },
  {
    module: "M2",
    text: "Modelling: age-standardised risk, regression, spatial model, January forecast and alerts, then the ranked decision table and the 14-day microplan.",
  },
];

export default async function MeaslesPage({ searchParams }: PageProps<"/measles">) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Measles"
        description="Group 3 capstone: which three Northern Region districts should receive priority measles investigation and immunisation outreach planning, and what evidence supports those choices."
      />

      <Alert title="Synthetic teaching data: not for public health decisions">
        Every count, coverage estimate and outbreak in the measles pack is simulated. This is a
        fictional January 2025 planning exercise, and its results must never be presented as Ghana
        Health Service findings.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>The Director&apos;s decision</CardTitle>
              <CardDescription>
                Northern Region · evidence window January 2023 – December 2024 · other regions as
                comparators only
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-3 pt-0 text-sm text-ink-2">
            <p>
              <span className="font-medium text-ink">Capacity:</span> two mobile immunisation
              outreach teams and one surveillance verification team, for an initial 14-day planning
              and field-visit period.
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              {QUESTIONS.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
            <p>
              No ranking without the quality and uncertainty of the evidence behind it. Hand over:
              a one-page decision note, an evidence report, a burden map, a coverage or surveillance
              quality map, a model uncertainty or alert figure, and a ranked decision table.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Preparation, then modelling</CardTitle>
              <CardDescription>
                Two modules, run in order below. M2 writes the three figures and{" "}
                <code className="font-mono text-xs">decision_table_northern.csv</code>.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            <ol className="space-y-2.5 text-sm">
              {STEPS.map((step) => (
                <li key={step.module} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
                  <span className="font-medium text-ink">{step.module}</span>
                  <span className="text-ink-2">{step.text}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <GeoEpiWorkspace launch={geoEpiLaunch(await searchParams, "measles")} />
    </div>
  );
}
