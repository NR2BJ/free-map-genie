import { useAppDispatch, useAppSelector } from "@/contexts/popup/hooks";
import { addBookmarkAsync, selectBookmarkAdding } from "./bookmarksSlice";

import style from "./Bookmarks.module.scss";

export const BookmarkAddButton = ({}: BookmarkAddButton.Props) => {
  const dispatch = useAppDispatch();
  const adding = useAppSelector(selectBookmarkAdding);

  const onClick = () => {
    dispatch(addBookmarkAsync());
  };

  return (
    <button type="button" className={style.bookmarkContainer} onClick={onClick}
      disabled={adding} title={adding ? "Adding bookmark..." : "Bookmark current page"}
      aria-label="Bookmark current page">
      <span className={style.bookmarkAddIcon}><FontIcon icon="plus" /></span>
    </button>
  );
};

export namespace BookmarkAddButton {
  export interface Props {}
}
