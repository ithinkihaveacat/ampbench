import { basename } from "path";
import * as linter from "../src";
import {
  withFixture,
  assertEqual,
  assertFn,
  runTestList,
  assertMatch,
  runTest,
  assertNotEqual
} from "./lib";

const PASS = linter.PASS();

withFixture("thumbnails1", () =>
  assertFn<linter.Message[]>(
    `${linter.StoryMetadataThumbnailsAreOk.name} - correctly sized`,
    runTestList(
      linter.StoryMetadataThumbnailsAreOk,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    actual => {
      return actual.length === 0 ? "" : "expected no errors";
    }
  )
);

withFixture("thumbnails2", () =>
  assertMatch(
    `${linter.StoryMetadataThumbnailsAreOk.name} - publisher-logo-src missing`,
    runTestList(
      linter.StoryMetadataThumbnailsAreOk,
      "https://regular-biology.glitch.me/"
    ),
    "publisher-logo-src"
  )
);

withFixture("thumbnails3", () =>
  assertMatch(
    `${
      linter.StoryMetadataThumbnailsAreOk.name
    } - poster-portrait-src not found`,
    runTestList(linter.StoryMetadataThumbnailsAreOk, "http://localhost:5000/"),
    "not 200"
  )
);

withFixture("testvalidity1", () =>
  assertEqual(
    `${linter.IsValid.name} - valid`,
    runTest(linter.IsValid, "https://www.ampproject.org/"),
    PASS
  )
);

withFixture("testvalidity2", async () =>
  assertNotEqual(
    `${linter.IsValid.name} - not valid`,
    runTest(linter.IsValid, "https://precious-sturgeon.glitch.me/"),
    PASS
  )
);

withFixture("testcanonical1", () =>
  assertEqual(
    `${linter.LinkRelCanonicalIsOk.name} - canonical`,
    runTest(linter.LinkRelCanonicalIsOk, "https://regular-biology.glitch.me/"),
    PASS
  )
);

withFixture("testcanonical2", () =>
  assertMatch(
    `${linter.LinkRelCanonicalIsOk.name} - not canonical`,
    runTest(linter.LinkRelCanonicalIsOk, "https://regular-biology.glitch.me/"),
    "https://regular-biology.glitch.me/"
  )
);

withFixture("testcanonical3", () =>
  assertEqual(
    `${linter.LinkRelCanonicalIsOk.name} - relative`,
    runTest(linter.LinkRelCanonicalIsOk, "https://regular-biology.glitch.me/"),
    PASS
  )
);

withFixture("testvideosize1", () =>
  assertEqual(
    `${linter.AmpVideoIsSmall.name} - too big`,
    runTest(linter.AmpVideoIsSmall, "https://regular-biology.glitch.me/"),
    {
      message:
        "videos over 4MB: [https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4]",
      status: "FAIL"
    }
  )
);

withFixture("testvideosize2", () =>
  assertEqual(
    `${linter.AmpVideoIsSmall.name} - good size #1`,
    runTest(linter.AmpVideoIsSmall, "https://regular-biology.glitch.me/"),
    PASS
  )
);

withFixture("testvideosize3", () =>
  assertEqual(
    `${linter.AmpVideoIsSmall.name} - good size #2`,
    runTest(
      linter.AmpVideoIsSmall,
      "https://ampbyexample.com/stories/features/media/preview/embed/"
    ),
    PASS
  )
);

withFixture("bookendsameorigin1", () =>
  assertEqual(
    `${linter.BookendAppearsOnOrigin.name} - configured correctly`,
    runTest(
      linter.BookendAppearsOnOrigin,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    PASS
  )
);

withFixture("bookendsameorigin2", () =>
  assertMatch(
    `${linter.BookendAppearsOnOrigin.name} - bookend not application/json`,
    runTest(
      linter.BookendAppearsOnOrigin,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    "application/json"
  )
);

withFixture("bookendsameorigin3", () =>
  assertMatch(
    `${linter.BookendAppearsOnOrigin.name} - bookend not JSON`,
    runTest(
      linter.BookendAppearsOnOrigin,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    "JSON"
  )
);

withFixture("bookendsameorgin4", () =>
  assertEqual(
    `${
      linter.BookendAppearsOnOrigin.name
    } - v0 AMP Story - configured correctly`,
    runTest(
      linter.BookendAppearsOnOrigin,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    PASS
  )
);

withFixture("bookendcache1", () =>
  assertEqual(
    `${linter.BookendAppearsOnCache.name} - configured correctly`,
    runTest(
      linter.BookendAppearsOnCache,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    PASS
  )
);

withFixture("bookendcache2", () =>
  assertMatch(
    `${linter.BookendAppearsOnCache.name} - incorrect headers`,
    runTest(
      linter.BookendAppearsOnCache,
      "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
    ),
    "access-control-allow-origin"
  )
);

withFixture("ampstoryv1metadata1", () =>
  assertEqual(
    `${linter.StoryMetadataIsV1.name} - valid metadata`,
    runTest(
      linter.StoryMetadataIsV1,
      "https://ithinkihaveacat.github.io/hello-world-amp-story/"
    ),
    PASS
  )
);

withFixture("ampstoryv1metadata2", () =>
  assertMatch(
    `${linter.StoryMetadataIsV1.name} - invalid metadata`,
    runTest(
      linter.StoryMetadataIsV1,
      "https://ithinkihaveacat-hello-world-amp-story-7.glitch.me/"
    ),
    "publisher-logo-src"
  )
);

withFixture("ampimg1", () =>
  assertFn<linter.Message[]>(
    `${linter.AmpImgHeightWidthIsOk.name} - height/width are incorrect #1`,
    runTestList(
      linter.AmpImgHeightWidthIsOk,
      "https://ampbyexample.com/components/amp-img/"
    ),
    res => {
      if (res.length !== 3) {
        return "expected 3 failures";
      }
      const message = res[1].message;
      if (typeof message !== "string" || !message.match("does-not-exist")) {
        return "does-not-exist.jpg should be a 404";
      }
      return "";
    }
  )
);

withFixture("ampimg2", () =>
  assertFn<linter.Message[]>(
    `${linter.AmpImgHeightWidthIsOk.name} - height/width are incorrect #2`,
    runTestList(
      linter.AmpImgHeightWidthIsOk,
      "https://www.ampproject.org/docs/reference/components/amp-story"
    ),
    res => {
      if (res.length !== 6) {
        return "expected 6 failures";
      }
      const message1 = res[0].message;
      if (
        typeof message1 !== "string" ||
        !message1.match("amp-story-tag-hierarchy")
      ) {
        return "amp-story-tag-hierarchy.png is wrong ratio";
      }
      const message2 = res[5].message;
      if (typeof message2 !== "string" || !message2.match("layers-layer-3")) {
        return "layers-layer-3.jpg is too big";
      }
      return "";
    }
  )
);

withFixture("ampimg3", () =>
  assertFn<linter.Message[]>(
    `${linter.AmpImgHeightWidthIsOk.name} - height/width are correct`,
    runTestList(
      linter.AmpImgHeightWidthIsOk,
      "https://ampbyexample.com/introduction/hello_world/"
    ),
    res => {
      return res.length === 0
        ? ""
        : `expected 0 failures, got ${JSON.stringify(res)}`;
    }
  )
);

withFixture("cors1", () =>
  assertFn<linter.Message[]>(
    `${linter.EndpointsAreAccessibleFromOrigin.name} - all headers correct`,
    runTestList(
      linter.EndpointsAreAccessibleFromOrigin,
      "https://swift-track.glitch.me/"
    ),
    res => {
      return res.length === 0
        ? ""
        : `expected 0 failures, got ${JSON.stringify(res)}`;
    }
  )
);

withFixture("cors2", () =>
  assertMatch(
    `${linter.EndpointsAreAccessibleFromOrigin.name} - endpoint is 404`,
    runTestList(
      linter.EndpointsAreAccessibleFromOrigin,
      "https://swift-track.glitch.me/"
    ),
    "404"
  )
);

withFixture("cors3", () =>
  assertMatch(
    `${
      linter.EndpointsAreAccessibleFromOrigin.name
    } - endpoint not application/json`,
    runTestList(
      linter.EndpointsAreAccessibleFromOrigin,
      "https://swift-track.glitch.me/"
    ),
    "application/json"
  )
);

withFixture("cors4", () =>
  assertEqual(
    `${linter.EndpointsAreAccessibleFromCache.name} - all headers correct`,
    runTestList(
      linter.EndpointsAreAccessibleFromCache,
      "https://swift-track.glitch.me/"
    ),
    []
  )
);

withFixture("sxgvary1", () => {
  const expected = "FAIL";
  return assertFn(
    `${linter.SxgVaryOnAcceptAct.name} - vary header not returned`,
    runTest(linter.SxgVaryOnAcceptAct, "https://boundless-stealer.glitch.me/"),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}`
  );
});

withFixture("sxgvary2", () => {
  const expected = "FAIL";
  return assertFn(
    `${linter.SxgVaryOnAcceptAct.name} - no vary on amp-cache-transform`,
    runTest(linter.SxgVaryOnAcceptAct, "https://boundless-stealer.glitch.me/"),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}`
  );
});

withFixture("sxgvary3", () => {
  const expected = "FAIL";
  return assertFn(
    `${linter.SxgVaryOnAcceptAct.name} - no vary on accept`,
    runTest(linter.SxgVaryOnAcceptAct, "https://boundless-stealer.glitch.me/"),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}`
  );
});

withFixture("sxgvary4", () => {
  const expected = "PASS";
  return assertFn(
    `${
      linter.SxgVaryOnAcceptAct.name
    } - vary on accept and amp-cache-transform`,
    runTest(linter.SxgVaryOnAcceptAct, "https://boundless-stealer.glitch.me/"),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}`
  );
});

withFixture("sxgconneg1", () => {
  const expected = "PASS";
  return assertFn(
    `${
      linter.SxgContentNegotiationIsOk.name
    } - application/signed-exchange supported`,
    runTest(linter.SxgContentNegotiationIsOk, "https://azei-package-test.com/"),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}, message: ${
            res.message
          }`
  );
});

withFixture("sxgconneg2", () => {
  const expected = "FAIL";
  return assertFn(
    `${
      linter.SxgContentNegotiationIsOk.name
    } - application/signed-exchange not supported`,
    runTest(
      linter.SxgContentNegotiationIsOk,
      "https://boundless-stealer.glitch.me/"
    ),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}, message: ${
            res.message
          }`
  );
});

withFixture("sxgconneg3", () => {
  const expected = "FAIL";
  return assertFn(
    `${
      linter.SxgContentNegotiationIsOk.name
    } - application/signed-exchange incorrectly supported`,
    runTest(linter.SxgContentNegotiationIsOk, "https://azei-package-test.com/"),
    res =>
      res.status === expected
        ? ""
        : `expected: ${expected}, actual: ${res.status}, message: ${
            res.message
          }`
  );
});

console.log(`# ${basename(__filename)} - tests with mocked HTTP responses`);
console.log(`1..33`);
