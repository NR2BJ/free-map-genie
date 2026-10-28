import { useAppSelector } from "@/contexts/popup/hooks";
import { selectAppHomepage, selectAppAuthor } from "../appSlice";

import { Version } from "./Version";
import { Connection } from "./Connection";
import { SaveIndicator } from "./SaveIndicator";

import style from "./Footer.module.scss";

export const Footer = () => {
  const homepage = useAppSelector(selectAppHomepage);
  const author = useAppSelector(selectAppAuthor);

  const openHomepage = async () => {
    await browser.tabs.create({ url: homepage });
    window.close();
  };

  return (
    <div className={style.footer}>
      <div className={style.left}>
        <button type="button" title="Open NR2BJ's GitHub repository" className={style.author} onClick={openHomepage}>
          {author}
        </button>
      </div>
      <div className="center">
        <Connection />
        <SaveIndicator />
      </div>
      <div className="right">
        <Version />
      </div>
    </div>
  );
};
