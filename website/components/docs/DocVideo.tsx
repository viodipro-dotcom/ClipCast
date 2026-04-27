import styles from "./DocVideo.module.css";

type Props =
  | { youtubeId: string; src?: never; title?: string }
  | { src: string; youtubeId?: never; title?: string };

export function DocVideo(props: Props) {
  if (props.youtubeId) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.embed}>
          <iframe
            src={`https://www.youtube.com/embed/${props.youtubeId}`}
            title={props.title ?? "YouTube video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className={styles.iframe}
          />
        </div>
        {props.title && <p className={styles.caption}>{props.title}</p>}
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <video
        src={props.src}
        controls
        className={styles.video}
        title={props.title ?? "Video"}
      >
        Your browser does not support the video tag.
      </video>
      {props.title && <p className={styles.caption}>{props.title}</p>}
    </div>
  );
}
