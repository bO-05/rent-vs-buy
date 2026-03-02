import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { InfoTip } from "@/components/InfoTip";
import type { SimulationInput } from "@shared/schema";
import {
  Percent,
  Calendar,
  TrendingUp,
  Shield,
  Wrench,
  BarChart3,
  Globe,
  Link2,
} from "lucide-react";

interface ParameterFormProps {
  params: SimulationInput;
  onParamsChange: (params: SimulationInput) => void;
  currencySymbol?: string;
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  icon: Icon,
  paramKey,
  params,
  onChange,
  tip,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  icon: typeof Percent;
  paramKey: keyof SimulationInput;
  params: SimulationInput;
  onChange: (params: SimulationInput) => void;
  tip?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">{label}</Label>
          {tip && <InfoTip text={tip} />}
        </div>
        <span className="text-xs font-mono font-semibold text-primary">
          {value}{suffix}
        </span>
      </div>
      <Slider
        data-testid={`slider-${String(paramKey)}`}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange({ ...params, [paramKey]: v })}
      />
    </div>
  );
}

export function ParameterForm({ params, onParamsChange, currencySymbol = "$" }: ParameterFormProps) {
  return (
    <Tabs defaultValue="mortgage" className="w-full">
      <TabsList className="grid w-full grid-cols-4 mb-4">
        <TabsTrigger value="mortgage" data-testid="tab-mortgage" className="text-xs">Mortgage</TabsTrigger>
        <TabsTrigger value="costs" data-testid="tab-costs" className="text-xs">Costs</TabsTrigger>
        <TabsTrigger value="growth" data-testid="tab-growth" className="text-xs">Growth</TabsTrigger>
        <TabsTrigger value="advanced" data-testid="tab-advanced" className="text-xs">Advanced</TabsTrigger>
      </TabsList>

      <TabsContent value="mortgage" className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="homePrice" className="text-xs font-medium">Home Price</Label>
            <span className="text-xs text-muted-foreground">{currencySymbol}{Math.round(params.homePrice).toLocaleString()}</span>
          </div>
          <Input
            id="homePrice"
            data-testid="input-home-price"
            type="number"
            value={params.homePrice}
            onChange={(e) => onParamsChange({ ...params, homePrice: Number(e.target.value) })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="monthlyRent" className="text-xs font-medium">Monthly Rent</Label>
            <span className="text-xs text-muted-foreground">{currencySymbol}{Math.round(params.monthlyRent).toLocaleString()}</span>
          </div>
          <Input
            id="monthlyRent"
            data-testid="input-monthly-rent"
            type="number"
            value={params.monthlyRent}
            onChange={(e) => onParamsChange({ ...params, monthlyRent: Number(e.target.value) })}
          />
        </div>

        <ParamSlider label="Down Payment" value={params.downPaymentPercent} min={0} max={100} step={1} suffix="%" icon={Percent} paramKey="downPaymentPercent" params={params} onChange={onParamsChange} />
        <ParamSlider label="Mortgage Rate" value={params.mortgageRate} min={0} max={20} step={0.1} suffix="%" icon={Percent} paramKey="mortgageRate" params={params} onChange={onParamsChange} tip="The annual interest rate on your home loan" />
        <ParamSlider label="Loan Term" value={params.mortgageTermYears} min={5} max={30} step={1} suffix=" yrs" icon={Calendar} paramKey="mortgageTermYears" params={params} onChange={onParamsChange} />
      </TabsContent>

      <TabsContent value="costs" className="space-y-5">
        <p className="text-xs text-muted-foreground font-medium mb-1">Buying & selling costs</p>
        <ParamSlider label="Purchase tax" value={params.purchaseTaxRate} min={0} max={20} step={0.5} suffix="%" icon={Shield} paramKey="purchaseTaxRate" params={params} onChange={onParamsChange} tip="One-time tax or stamp duty when you buy the property. Varies by country." />
        <ParamSlider label="Legal fees" value={params.legalFeesPercent} min={0} max={10} step={0.1} suffix="%" icon={Percent} paramKey="legalFeesPercent" params={params} onChange={onParamsChange} tip="Notary, lawyer, and other legal fees for the property transfer." />
        <ParamSlider label="Agency fee" value={params.agencyFeePercent} min={0} max={10} step={0.5} suffix="%" icon={Percent} paramKey="agencyFeePercent" params={params} onChange={onParamsChange} tip="Commission paid to the real estate agent." />
        <ParamSlider label="Selling tax" value={params.sellingTaxRate} min={0} max={20} step={0.5} suffix="%" icon={Shield} paramKey="sellingTaxRate" params={params} onChange={onParamsChange} tip="Capital gains tax or transfer tax when you sell the property." />

        <Separator />
        <p className="text-xs text-muted-foreground font-medium mb-1">Yearly ownership costs</p>
        <ParamSlider label="Yearly property tax" value={params.propertyTaxRate} min={0} max={5} step={0.1} suffix="%" icon={Shield} paramKey="propertyTaxRate" params={params} onChange={onParamsChange} tip="Annual property tax as a percentage of the home's value." />
        <ParamSlider label="Maintenance" value={params.maintenanceRate} min={0} max={5} step={0.1} suffix="%" icon={Wrench} paramKey="maintenanceRate" params={params} onChange={onParamsChange} tip="Annual upkeep costs as a percentage of the home's value." />
        <ParamSlider label="Insurance" value={params.insuranceRate} min={0} max={3} step={0.1} suffix="%" icon={Shield} paramKey="insuranceRate" params={params} onChange={onParamsChange} />
      </TabsContent>

      <TabsContent value="growth" className="space-y-5">
        <p className="text-xs text-muted-foreground font-medium mb-1">Growth & uncertainty</p>

        <ParamSlider label="Home value growth rate" value={params.homeAppreciationMu} min={-5} max={15} step={0.5} suffix="%" icon={TrendingUp} paramKey="homeAppreciationMu" params={params} onChange={onParamsChange} tip="How fast home prices tend to rise each year on average." />
        <ParamSlider label="Home price unpredictability" value={params.homeAppreciationSigma} min={0.02} max={0.4} step={0.01} suffix="" icon={BarChart3} paramKey="homeAppreciationSigma" params={params} onChange={onParamsChange} tip="How much home prices swing year to year. Higher means more uncertainty." />

        <Separator />
        <ParamSlider label="Rent increase rate" value={params.rentGrowthMu} min={0} max={15} step={0.5} suffix="%" icon={TrendingUp} paramKey="rentGrowthMu" params={params} onChange={onParamsChange} tip="How fast rents tend to go up each year on average." />
        <ParamSlider label="Rent unpredictability" value={params.rentGrowthSigma} min={0.02} max={0.3} step={0.01} suffix="" icon={BarChart3} paramKey="rentGrowthSigma" params={params} onChange={onParamsChange} tip="How much rents swing year to year." />

        <Separator />
        <ParamSlider label="Investment growth rate" value={params.investmentReturnMu} min={0} max={20} step={0.5} suffix="%" icon={TrendingUp} paramKey="investmentReturnMu" params={params} onChange={onParamsChange} tip="Expected yearly return if you invest instead of buying. Think stock market or index funds." />
        <ParamSlider label="Investment unpredictability" value={params.investmentReturnSigma} min={0.02} max={0.4} step={0.01} suffix="" icon={BarChart3} paramKey="investmentReturnSigma" params={params} onChange={onParamsChange} tip="How much investment returns swing year to year." />

        <Separator />
        <ParamSlider label="Inflation rate" value={params.inflationRate} min={0} max={10} step={0.5} suffix="%" icon={TrendingUp} paramKey="inflationRate" params={params} onChange={onParamsChange} tip="How fast prices rise in general. Used to convert future values into today's money." />
      </TabsContent>

      <TabsContent value="advanced" className="space-y-5">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-muted-foreground font-medium">How factors move together</p>
          <InfoTip text="When home prices go up, do rents tend to follow? These sliders control how linked these factors are. 0 = independent, 1 = move in lockstep." />
        </div>
        <ParamSlider label="Home prices & rents" value={params.correlationHomeRent} min={-1} max={1} step={0.05} suffix="" icon={Link2} paramKey="correlationHomeRent" params={params} onChange={onParamsChange} />
        <ParamSlider label="Home prices & investments" value={params.correlationHomeInvestment} min={-1} max={1} step={0.05} suffix="" icon={Link2} paramKey="correlationHomeInvestment" params={params} onChange={onParamsChange} />
        <ParamSlider label="Rents & investments" value={params.correlationRentInvestment} min={-1} max={1} step={0.05} suffix="" icon={Link2} paramKey="correlationRentInvestment" params={params} onChange={onParamsChange} />

        <Separator />
        <p className="text-xs text-muted-foreground font-medium mb-1">Buyer type</p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium">I'm a non-resident buyer</Label>
            <InfoTip text="Non-resident or foreign buyers often face extra taxes, ownership restrictions, or legal requirements depending on the country." />
          </div>
          <Switch
            data-testid="switch-non-resident"
            checked={params.isNonResident}
            onCheckedChange={(checked) => onParamsChange({ ...params, isNonResident: checked })}
          />
        </div>
        {params.isNonResident && (
          <ParamSlider label="Extra non-resident fees" value={params.nonResidentExtraPercent} min={0} max={20} step={0.5} suffix="%" icon={Percent} paramKey="nonResidentExtraPercent" params={params} onChange={onParamsChange} tip="Additional costs for non-resident or foreign buyers." />
        )}

        <Separator />
        <ParamSlider label="Number of scenarios" value={params.numSimulations} min={500} max={5000} step={500} suffix="" icon={BarChart3} paramKey="numSimulations" params={params} onChange={onParamsChange} tip="More scenarios = more accurate results, but takes longer to calculate." />
      </TabsContent>
    </Tabs>
  );
}
