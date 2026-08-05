export type ScoutAuthResponse = {
  SessionId: string;
  IsAuthenticated: boolean;
  IsAuthorized?: boolean;
  UserName?: string;
  UserId?: number;
  ExpireDate?: string;
};

export type ScoutUnit = {
  UnitId: number;
  Name: string;
  StateNumber?: string;
  GarageNumber?: string;
  Model?: string;
  Brand?: string;
  Owner?: string;
};

export type ScoutUnitsResponse = {
  Units?: ScoutUnit[];
  State?: ScoutState;
};

export type ScoutSubscribeResponse = {
  SessionId: { Id: string } | null;
  State?: ScoutState;
};

export type ScoutOnlinePoint = {
  Address?: string;
  DeviceId?: {
    Protocol?: { Value?: string };
    SerialId?: string;
  };
  IsNavigationValid?: boolean;
  LastMessageTime?: string;
  Navigation?: {
    Location?: { Latitude?: number; Longitude?: number };
    Speed?: number;
    AltitudeMeters?: number | null;
    Angle?: number;
    SatellitesCount?: number;
  };
  NavigationTime?: string;
};

export type ScoutOnlineDataResponse = {
  OnlineDataCollection?: {
    DataCollection?: ScoutOnlinePoint[];
    Targets?: number[];
  } | null;
  State?: ScoutState;
};

export type ScoutState = {
  ErrorCodes?: number[];
  Status?: { Value?: string };
};

export type ScoutConfig = {
  serverUrl: string;
  login: string;
  password: string;
};

/** GUID типа «транспортное средство» для StatisticsController */
export const SCOUT_UNIT_OBJECT_TYPE_ID = '0F1E3A4A-88F5-4166-9BE8-76033DD85D08';

export type ScoutNavTrackPoint = {
  lat: number;
  lon: number;
  speedKmh: number | null;
  recordedAt: string;
};

export type ScoutStatisticsSessionResponse = {
  OperationResult?: { Value?: string };
  Session?: { StatisticsSessionId?: string };
};

export type ScoutNavigationFiltrationResult = {
  ChunkInfo?: {
    ChunkNumber?: number;
    ErrorText?: string | null;
    IsFinalChunk?: boolean;
    Status?: { Value?: string };
  };
  Statistics?: {
    Points?: Array<{
      Timestamp?: string;
      IsNavigationValid?: boolean;
      Navigation?: {
        Location?: { Latitude?: number; Longitude?: number };
        Speed?: number;
      };
    }>;
  } | null;
};
