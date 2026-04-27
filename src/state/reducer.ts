export type GuardState = {
  hasUnsavedChanges: boolean;
  isRenaming: boolean;
  hasPartialFailure: boolean;
};

export type AppState = {
  guard: GuardState;
};

export const initialState: AppState = {
  guard: {
    hasUnsavedChanges: false,
    isRenaming: false,
    hasPartialFailure: false,
  },
};

type Action =
  | { type: "MARK_DIRTY"; value: boolean }
  | { type: "RENAME_STARTED" }
  | { type: "RENAME_FINISHED"; success: number; failed: number };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "MARK_DIRTY":
      return { ...state, guard: { ...state.guard, hasUnsavedChanges: action.value } };
    case "RENAME_STARTED":
      return { ...state, guard: { ...state.guard, isRenaming: true } };
    case "RENAME_FINISHED":
      return {
        ...state,
        guard: {
          ...state.guard,
          isRenaming: false,
          hasUnsavedChanges: false,
          hasPartialFailure: action.failed > 0,
        },
      };
    default:
      return state;
  }
}
