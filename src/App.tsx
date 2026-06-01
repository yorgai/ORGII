import { AppBootstrap } from "@src/app/root/AppBootstrap";
import { AppProviders } from "@src/app/root/AppProviders";

const App = () => {
  return (
    <AppProviders>
      <AppBootstrap />
    </AppProviders>
  );
};

export default App;
