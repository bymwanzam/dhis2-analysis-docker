/** Shapes returned by the DHIS2 Web API that this app relies on. */

export type TokenType = "ApiToken" | "Bearer";

export interface Connection {
  baseUrl: string;
  token: string;
  tokenType: TokenType;
}

/** Everything about a connection that is safe to send to the browser. */
export interface ConnectionStatus {
  connected: boolean;
  baseUrl?: string;
  tokenType?: TokenType;
  /** Credentials come from server env vars and cannot be changed in the UI. */
  managedByEnv?: boolean;
  user?: MeResponse;
  system?: SystemInfo;
  /** Hours since analytics tables were last generated, computed on the server. */
  analyticsAgeHours?: number;
  error?: string;
}

export interface MeResponse {
  id: string;
  username?: string;
  displayName?: string;
  email?: string;
  organisationUnits?: IdName[];
  authorities?: string[];
}

export interface SystemInfo {
  version?: string;
  revision?: string;
  contextPath?: string;
  serverDate?: string;
  calendar?: string;
  intervalSinceLastAnalyticsTableSuccess?: string;
  lastAnalyticsTableSuccess?: string;
}

export interface IdName {
  id: string;
  displayName: string;
  name?: string;
}

export interface OrgUnit extends IdName {
  level?: number;
  leaf?: boolean;
  path?: string;
  children?: OrgUnit[];
}

export interface OrgUnitLevel extends IdName {
  level: number;
}

export interface MetadataPage<T> {
  pager?: Pager;
  [key: string]: T[] | Pager | undefined;
}

export interface Pager {
  page: number;
  pageSize: number;
  pageCount?: number;
  total?: number;
}

export interface AnalyticsHeader {
  name: string;
  column: string;
  valueType: string;
  type: string;
  hidden: boolean;
  meta: boolean;
}

export interface AnalyticsMetaItem {
  uid?: string;
  name: string;
  code?: string;
  dimensionItemType?: string;
  valueType?: string;
  totalAggregationType?: string;
}

export interface AnalyticsResponse {
  headers: AnalyticsHeader[];
  metaData: {
    items: Record<string, AnalyticsMetaItem>;
    dimensions: Record<string, string[]>;
    /** Organisation unit id to a slash-separated chain of ancestor ids. */
    ouHierarchy?: Record<string, string>;
  };
  rows: string[][];
  width?: number;
  height?: number;
}

/** A metadata item picked into a query, kept with its dimension. */
export interface DimensionItem {
  id: string;
  displayName: string;
  /** Which DHIS2 object list it came from — drives the analytics prefix. */
  kind?: "indicator" | "dataElement" | "dataSet" | "programIndicator";
}
